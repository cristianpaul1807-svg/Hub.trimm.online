// ============================================================
// TRIMM Hub — Vista previa y correo de prueba
//
// Elegir plantilla sin verla es elegir a ciegas. Esta función devuelve el
// HTML exacto que saldría —el mismo renderizador que usa el worker, no una
// aproximación— y, si se le pide, lo manda al buzón de quien lo pide.
//
// El correo de prueba va SIEMPRE a la dirección de la sesión, nunca a una
// que llegue en el cuerpo de la petición: si no, esto sería un servicio
// gratuito para mandar correo a desconocidos desde nuestro dominio.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  corsHeaders, json, RESEND_KEY, MARKETING_FROM, marketingSenderProblem,
  APP_URL, HUB_URL,
} from '../_shared/campaign.ts'
import { renderEmail, type Template, type Brand } from '../_shared/templates.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Una prueba por minuto y cuenta. Sin esto, el botón de "enviar prueba"
// es un grifo abierto contra la reputación del dominio de marketing.
const ESPERA_ENTRE_PRUEBAS_MS = 60_000
const ultimaPrueba = new Map<string, number>()

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user }, error: authError } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { template_id, template, send_test, business_name, discount_value } = await req.json()

    // ── De dónde sale la plantilla ─────────────────────────────────
    // Puede venir por id (una guardada) o entera en el cuerpo (lo que el
    // usuario tiene a medio escribir en el editor, todavía sin guardar).
    let t: Template | null = null

    if (template_id) {
      const { data } = await supabase
        .from('hub_email_templates')
        .select('layout, subject, preheader, headline, body, cta_label, accent_color, image_url, hub_owner_id, is_system')
        .eq('id', template_id)
        .maybeSingle()

      // Se puede previsualizar una del sistema o una propia. La de otro
      // grupo, no: el cuerpo del correo es información suya.
      if (!data || (!data.is_system && data.hub_owner_id !== user.id)) {
        return json({ error: 'Plantilla no encontrada' }, 404)
      }
      t = data as Template
    } else if (template) {
      t = template as Template
    }

    if (!t?.body || !t?.subject) {
      return json({ error: 'Falta el asunto o el cuerpo' }, 400)
    }

    const { data: brand } = await supabase
      .from('hub_brand')
      .select('logo_url, accent_color, from_name, signature, footer_note')
      .eq('hub_owner_id', user.id)
      .maybeSingle()

    // ── Datos de ejemplo ───────────────────────────────────────────
    // El nombre del negocio sale de una sucursal real del grupo para que la
    // vista previa se parezca a lo que va a recibir la gente.
    let negocio = String(business_name ?? '').trim()
    if (!negocio) {
      const { data: biz } = await supabase
        .from('hub_connections')
        .select('businesses(name)')
        .eq('hub_owner_id', user.id)
        .limit(1)
        .maybeSingle()
      negocio = (biz as any)?.businesses?.name?.trim() || 'Tu negocio'
    }

    const rendered = renderEmail(t, {
      clientName: 'Ana',
      businessName: negocio,
      discountValue: Number.isFinite(discount_value) ? discount_value : 10,
      // Enlaces de ejemplo: la vista previa no debe atribuir reservas ni
      // dar de baja a nadie si alguien pincha.
      bookingUrl: `${APP_URL}/b/ejemplo`,
      unsubscribeUrl: `${HUB_URL}/baja?t=ejemplo`,
    }, (brand ?? null) as Brand | null)

    if (!send_test) {
      return json({ success: true, subject: rendered.subject, html: rendered.html })
    }

    // ── Correo de prueba ───────────────────────────────────────────
    const problema = marketingSenderProblem()
    if (problema) return json({ error: problema }, 500)
    if (!RESEND_KEY) return json({ error: 'Falta la clave de Resend' }, 500)

    const ahora = Date.now()
    const anterior = ultimaPrueba.get(user.id) ?? 0
    if (ahora - anterior < ESPERA_ENTRE_PRUEBAS_MS) {
      const quedan = Math.ceil((ESPERA_ENTRE_PRUEBAS_MS - (ahora - anterior)) / 1000)
      return json({ error: `Espera ${quedan} segundos antes de otra prueba` }, 429)
    }
    ultimaPrueba.set(user.id, ahora)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${brand?.from_name?.trim() || negocio} <${MARKETING_FROM}>`,
        to: [user.email],   // siempre el de la sesión
        subject: `[PRUEBA] ${rendered.subject}`,
        html: rendered.html,
      }),
    })

    if (!res.ok) {
      const detalle = await res.text()
      console.error('Resend rechazó la prueba:', res.status, detalle)
      return json({ error: 'No se pudo enviar la prueba' }, 502)
    }

    return json({ success: true, sent_to: user.email, subject: rendered.subject, html: rendered.html })

  } catch (err) {
    console.error(err)
    return json({ error: err?.message ?? 'Error inesperado' }, 500)
  }
})
