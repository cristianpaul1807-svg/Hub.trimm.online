// ============================================================
// TRIMM Hub — Worker de envío
//
// Antes: una invocación intentaba enviar la campaña entera en serie, lo que
// agotaba el tiempo de ejecución en cuanto la campaña era grande y dejaba
// el estado colgado en 'sending' para siempre.
//
// Ahora: cada invocación reserva un tramo de la cola, lo envía y sale. El
// cron vuelve a llamar hasta que no queda nada. La reserva usa
// FOR UPDATE SKIP LOCKED, así que pueden correr varios workers a la vez sin
// que ninguno envíe lo que ya envió otro.
//
// Se puede invocar:
//   · con { campaign_id }  → drena esa campaña
//   · sin cuerpo           → busca cualquier campaña pendiente (modo cron)
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  corsHeaders, json, RESEND_KEY, MARKETING_FROM, marketingSenderProblem, replyToFor,
  bookingUrl, unsubscribeUrl, unsubscribeHeaders, renderTemplate,
  type Recipient, type BusinessInfo,
} from '../_shared/campaign.ts'
import { renderEmail, type Template, type Brand } from '../_shared/templates.ts'

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)

// Resend acepta hasta 100 mensajes por llamada al endpoint por lotes.
const BATCH_SIZE = 100
// Tope por invocación. Cabe de sobra en el tiempo de una Edge Function y
// deja margen para que el cron reparta la carga.
const MAX_PER_INVOCATION = 500
// Límite por defecto de la cuenta: 2 peticiones por segundo.
const PAUSE_BETWEEN_BATCHES_MS = 600
// Margen de seguridad para cerrar limpiamente antes del corte por tiempo.
const TIME_BUDGET_MS = 50_000
const MAX_ATTEMPTS = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// El cron y la propia función no siempre llevan literalmente la misma clave:
// los cron guardan la clave service_role heredada del proyecto, mientras que
// a la función se le inyecta la que Supabase tenga vigente. Comparar cadenas
// hacía que el cron recibiera 401 y la cola no se drenara nunca.
//
// Como esta función se despliega con verify_jwt activo, la pasarela ya ha
// validado la firma antes de llegar aquí: leer el rol del token es
// suficiente y no se fía de nada sin verificar.
function isServiceRoleToken(token: string): boolean {
  if (!token) return false
  if (token === SERVICE_KEY) return true

  const parts = token.split('.')
  if (parts.length !== 3) return false

  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const startedAt = Date.now()

  try {
    if (!RESEND_KEY) {
      return json({ error: 'Falta la clave de Resend en la configuración' }, 500)
    }

    // Se comprueba antes de reservar nada de la cola: si el remitente está mal
    // configurado, la campaña se queda intacta y se puede relanzar en cuanto
    // se corrija, sin haber gastado saldo ni haber enviado nada.
    const senderProblem = marketingSenderProblem()
    if (senderProblem) {
      console.error(senderProblem)
      return json({ error: senderProblem }, 500)
    }

    const authHeader = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const isService = isServiceRoleToken(authHeader)

    let body: { campaign_id?: string } = {}
    try { body = await req.json() } catch { /* el cron llama sin cuerpo */ }

    // ── Elegir campaña ────────────────────────────────────────────────
    let campaignId = body.campaign_id ?? null

    if (!isService) {
      // Invocación desde el navegador: sólo sobre campañas propias.
      const { data: { user } } = await supabase.auth.getUser(authHeader)
      if (!user) return json({ error: 'Unauthorized' }, 401)
      if (!campaignId) return json({ error: 'Falta campaign_id' }, 400)

      const { data: owned } = await supabase
        .from('hub_campaigns').select('id')
        .eq('id', campaignId).eq('hub_owner_id', user.id).maybeSingle()
      if (!owned) return json({ error: 'Campaña no encontrada' }, 404)
    }

    if (!campaignId) {
      // Modo cron: la campaña encolada más antigua que siga teniendo trabajo.
      const { data: pending } = await supabase
        .from('hub_campaigns')
        .select('id')
        .in('status', ['queued', 'sending'])
        .order('queued_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!pending) return json({ success: true, idle: true })
      campaignId = pending.id
    }

    // ── Cargar campaña y sucursales ───────────────────────────────────
    const { data: campaign } = await supabase
      .from('hub_campaigns').select('*').eq('id', campaignId).single()

    if (!campaign) return json({ error: 'Campaña no encontrada' }, 404)
    if (!['queued', 'sending'].includes(campaign.status)) {
      return json({ success: true, skipped: `estado ${campaign.status}` })
    }

    // Plantilla y marca del grupo, una sola vez para toda la tanda.
    // Si la campaña es anterior a las plantillas, hub_render_context
    // devuelve la del sistema equivalente a su template_type.
    const { data: ctxRow } = await supabase.rpc('hub_render_context', {
      p_campaign_id: campaignId,
    })
    const plantilla: Template | null = ctxRow?.template ?? null
    const marca: Brand | null = ctxRow?.brand ?? null

    // ── El código de la campaña ───────────────────────────────────────
    // Se crea aquí, una vez por campaña y antes del primer envío, para que
    // todos los correos lleven el mismo. Es idempotente: si el worker
    // vuelve a entrar —y vuelve, cada tanda es una invocación— devuelve el
    // que ya existe en lugar de crear otro.
    //
    // El tope de canjes es el número de destinatarios: un código filtrado a
    // un grupo de WhatsApp no debería costar más que la campaña que lo
    // pagó.
    //
    // Si esto falla, la campaña sale igual, sin código. Perder un envío ya
    // pagado por no poder generar un código sería mucho peor que un correo
    // sin descuento canjeable, y el fallo queda en el registro.
    let codigo: string | null = null
    try {
      const { data: cod, error: codErr } = await supabase.rpc('hub_create_campaign_code', {
        p_campaign_id: campaignId,
        p_max_redemptions: campaign.recipients_count ?? null,
        p_days_valid: 60,
      })
      if (codErr) console.error('No se pudo crear el código de campaña', codErr)
      else codigo = cod?.code ?? null
    } catch (e) {
      console.error('No se pudo crear el código de campaña', e)
    }

    const { data: businessRows } = await supabase
      .from('businesses').select('id, name, slug, email').in('id', campaign.target_business_ids)

    const businesses = new Map<string, BusinessInfo>(
      (businessRows ?? []).map((b: BusinessInfo) => [b.id, b]),
    )

    await supabase.from('hub_campaigns').update({
      status: 'sending',
      sent_at: campaign.sent_at ?? new Date().toISOString(),
    }).eq('id', campaignId)

    // ── Drenar la cola ────────────────────────────────────────────────
    let processed = 0
    let sent = 0
    let failed = 0

    while (processed < MAX_PER_INVOCATION && Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data: batch, error: claimErr } = await supabase.rpc('hub_claim_recipient_batch', {
        p_campaign_id: campaignId,
        p_limit: BATCH_SIZE,
      })

      if (claimErr) {
        console.error('claim failed', claimErr)
        break
      }

      const recipients = (batch ?? []) as Recipient[]
      if (recipients.length === 0) break

      const payload = recipients.map((r) => {
        const biz = businesses.get(r.business_id) ?? businessRows?.[0]
        const bizName = (biz?.name ?? 'TRIMM').trim()

        // Con plantilla se renderiza desde la base de datos; sin ella se cae
        // a las tres de siempre, que siguen en el código. Ninguna campaña
        // debe quedarse sin poder enviarse por un fallo de configuración.
        const tpl = plantilla
          ? renderEmail(plantilla, {
              clientName: r.client_name,
              businessName: bizName,
              discountValue: campaign.discount_value,
              bookingUrl: bookingUrl(biz, r.unsubscribe_token),
              unsubscribeUrl: unsubscribeUrl(r.unsubscribe_token),
              promoCode: codigo,
              // El idioma no se pasa: renderEmail lo toma de la plantilla,
              // que es de donde tiene que salir.
            }, marca)
          : renderTemplate(campaign.template_type, {
              businessName: bizName,
              bookingUrl: bookingUrl(biz, r.unsubscribe_token),
              unsubscribeUrl: unsubscribeUrl(r.unsubscribe_token),
              clientName: r.client_name,
              discountValue: campaign.discount_value ?? undefined,
              promoCode: codigo,
            })

        // Las respuestas van al correo del negocio, no al buzón de marketing:
        // la recepción de marketing.trimm.online está desactivada y nadie la
        // lee. Quien contesta quiere hablar con su peluquería.
        const replyTo = replyToFor(biz)

        // Quien firma es la sucursal, salvo que el grupo haya fijado un
        // nombre propio: una cadena puede querer firmar siempre igual.
        const firmante = marca?.from_name?.trim() || bizName

        return {
          from: `${firmante} <${MARKETING_FROM}>`,
          to: [r.email],
          ...(replyTo ? { reply_to: replyTo } : {}),
          subject: campaign.custom_subject || tpl.subject,
          html: tpl.html,
          headers: unsubscribeHeaders(r.unsubscribe_token),
        }
      })

      let results: Array<{ id?: string }> = []
      let batchOk = false

      try {
        const res = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        if (res.ok) {
          const parsed = await res.json()
          results = parsed?.data ?? []
          batchOk = true
        } else {
          console.error('Resend rechazó el lote:', res.status, await res.text())
        }
      } catch (e) {
        console.error('Resend inaccesible:', e)
      }

      // ── Anotar el resultado de cada destinatario ────────────────────
      for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i]

        if (batchOk) {
          await supabase.rpc('hub_mark_recipient', {
            p_recipient_id: r.id,
            p_status: 'sent',
            p_resend_email_id: results[i]?.id ?? null,
            p_error: null,
          })
          sent++
        } else {
          // El fallo es del lote entero, no de esta dirección. Vuelve a la
          // cola salvo que ya haya agotado los reintentos.
          const { data: current } = await supabase
            .from('hub_campaign_recipients').select('attempts').eq('id', r.id).single()

          const exhausted = (current?.attempts ?? 0) >= MAX_ATTEMPTS
          await supabase.rpc('hub_mark_recipient', {
            p_recipient_id: r.id,
            p_status: exhausted ? 'failed' : 'queued',
            p_resend_email_id: null,
            p_error: exhausted ? 'Resend no aceptó el envío tras varios intentos' : null,
          })
          if (exhausted) failed++
        }
      }

      processed += recipients.length

      // Si el lote falló, no insistas de inmediato: da margen a que se
      // recupere lo que sea que esté fallando.
      await sleep(batchOk ? PAUSE_BETWEEN_BATCHES_MS : PAUSE_BETWEEN_BATCHES_MS * 4)
    }

    // ── Cierre ────────────────────────────────────────────────────────
    // hub_refresh_campaign_stats marca la campaña como completada por sí
    // sola cuando ya no queda nadie en cola.
    const { data: stats } = await supabase.rpc('hub_refresh_campaign_stats', {
      p_campaign_id: campaignId,
    })

    const pendingLeft = Number(stats?.pending ?? 0)

    if (pendingLeft === 0) {
      // Devolver el saldo de los envíos que se reservaron pero no salieron.
      const reserved = Number(campaign.credits_reserved ?? 0)
      const actuallySent = Number(stats?.sent ?? 0)
      const unused = reserved - actuallySent

      if (unused > 0) {
        await supabase.rpc('hub_refund_credits', {
          p_hub_owner_id: campaign.hub_owner_id,
          p_credits: unused,
          p_campaign_id: campaignId,
          p_note: 'Envíos reservados que no llegaron a salir',
        })
      }
    }

    return json({
      success: true,
      campaign_id: campaignId,
      processed,
      sent,
      failed,
      pending: pendingLeft,
      done: pendingLeft === 0,
    })

  } catch (err) {
    console.error(err)
    return json({ error: err?.message ?? 'Error inesperado' }, 500)
  }
})
