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
//
// Sirve a dos pantallas:
//
//   · Plantillas — se le pasa template_id (una guardada) o la plantilla
//     entera a medio escribir, y renderiza con renderEmail.
//
//   · El asistente de campaña — se le pasa campaign_type y renderiza con
//     renderTemplate, que es literalmente la función que usa el worker
//     cuando la campaña no lleva plantilla propia. Es el caso que más
//     importa: ahí alguien está a punto de pagar por un correo que no ha
//     visto nunca.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  corsHeaders, json, RESEND_KEY, MARKETING_FROM, marketingSenderProblem,
  APP_URL, HUB_URL, renderTemplate,
} from '../_shared/campaign.ts'
import { renderEmail, type Template, type Brand } from '../_shared/templates.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// El cupo de pruebas vive en la base de datos (hub_consume_test), no aquí.
// Un Map en memoria no limita nada: las Edge Functions arrancan en frío y
// cada instancia tiene el suyo, así que basta con caer en otra para
// saltárselo. 2 por plantilla y día, 10 al día por cuenta.

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user }, error: authError } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const {
      template_id, template, campaign_type,
      send_test, business_name, discount_value,
    } = await req.json()

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

    // En modo campaña no hay plantilla: la maqueta la pone renderTemplate.
    if (!campaign_type && (!t?.body || !t?.subject)) {
      return json({ error: 'Falta el asunto o el cuerpo' }, 400)
    }

    // Contra qué se cuenta la prueba. Una clave de texto y no un id, porque
    // una campaña del asistente todavía no existe en la base de datos.
    const clave = campaign_type
      ? `campana:${campaign_type}`
      : template_id ? `plantilla:${template_id}` : null

    const { data: brand } = await supabase
      .from('hub_brand')
      .select('logo_url, accent_color, from_name, signature, footer_note')
      .eq('hub_owner_id', user.id)
      .maybeSingle()

    // ── Datos de ejemplo ───────────────────────────────────────────
    // Salen de una sucursal real del grupo. El nombre, para que la vista
    // previa se parezca a lo que va a recibir la gente; y el identificador,
    // para que el botón lleve a una página que existe.
    //
    // La primera versión ponía /b/ejemplo, un identificador inventado, y el
    // botón del correo de prueba respondía «negocio no encontrado». Una
    // prueba sirve para ver lo que verá el cliente: si al pulsar el botón
    // sale un error, lo que aprendes es a desconfiar de todo el correo.
    const { data: vinculos } = await supabase
      .from('hub_connections')
      .select('businesses(name, slug)')
      .eq('hub_owner_id', user.id)
      .limit(20)

    const sucursales = (vinculos ?? [])
      .map((v: any) => v.businesses)
      .filter((b: any) => b?.slug)

    const pedido = String(business_name ?? '').trim()
    const elegida = sucursales.find((b: any) => b.name?.trim() === pedido)
      ?? sucursales[0]

    const negocio = pedido || elegida?.name?.trim() || 'Tu negocio'

    // El código de muestra. El de verdad no existe todavía —se crea al
    // lanzar la campaña— pero la caja tiene que verse, porque ocupa sitio
    // en el correo y cambia cómo se lee. Enseñar una vista previa sin ella
    // y que luego aparezca es exactamente lo que la vista previa evita.
    //
    // Lleva el mismo prefijo que llevará el real, para que el ancho y la
    // pinta sean los que van a salir.
    const prefijo = campaign_type === 'discount'
      ? `DTO${Math.round(Number(discount_value) || 10)}`
      : campaign_type === 'reengagement' ? 'VUELVE'
      : campaign_type === 'loyalty' ? 'PUNTOS'
      : 'TRIMM'
    const codigoMuestra = `${prefijo}-EJEMP`

    // El botón lleva a la reserva de verdad, pero SIN el ?tc= de la
    // campaña. Es la diferencia que importa: la página abre y se ve como la
    // verá el cliente, y a la vez la prueba no atribuye ninguna reserva a
    // una campaña que todavía no existe.
    //
    // Si el grupo no tuviera ninguna sucursal con identificador, se cae a
    // la portada en lugar de a una página inexistente.
    const enlaceReserva = elegida?.slug
      ? `${APP_URL}/b/${elegida.slug}`
      : APP_URL

    // El de baja sí va con un token falso, a propósito: dar de baja de
    // verdad desde una prueba sería mucho peor que ver un aviso de enlace
    // caducado.
    const datos = {
      clientName: 'Ana',
      businessName: negocio,
      discountValue: Number.isFinite(discount_value) ? discount_value : 10,
      bookingUrl: enlaceReserva,
      unsubscribeUrl: `${HUB_URL}/baja?t=ejemplo`,
      promoCode: codigoMuestra,
    }

    // La misma bifurcación que hace el worker al enviar de verdad: con
    // plantilla propia, renderEmail; sin ella, la maqueta del tipo de
    // campaña. Si aquí se eligiera distinto, la vista previa enseñaría un
    // correo que no es el que llega.
    const rendered = campaign_type && !t
      ? renderTemplate(campaign_type, datos)
      : renderEmail(t!, datos, (brand ?? null) as Brand | null)

    if (!send_test) {
      return json({ success: true, subject: rendered.subject, html: rendered.html })
    }

    // ── Correo de prueba ───────────────────────────────────────────
    const problema = marketingSenderProblem()
    if (problema) return json({ error: problema }, 500)
    if (!RESEND_KEY) return json({ error: 'Falta la clave de Resend' }, 500)

    // Hace falta algo contra lo que contar. Un borrador suelto no vale: con
    // cambiar una coma se tendrían pruebas infinitas.
    if (!clave) {
      return json({
        error: 'Guarda la plantilla antes de enviarte una prueba',
        needs_save: true,
      }, 400)
    }

    const { data: cupo, error: cupoErr } = await supabase.rpc('hub_consume_test_key', {
      p_hub_owner_id: user.id,
      p_key: clave,
      p_sent_to: user.email,
      p_template_id: template_id ?? null,
    })

    if (cupoErr) {
      console.error('hub_consume_test falló', cupoErr)
      return json({ error: 'No se pudo comprobar el cupo de pruebas' }, 500)
    }

    if (!cupo?.allowed) {
      return json({
        error: cupo?.reason === 'daily'
          ? 'Has llegado al máximo de 10 pruebas de hoy. Mañana se reinicia.'
          : campaign_type
            ? 'Ya has enviado las 2 pruebas de hoy para este tipo de campaña. Mañana se reinicia.'
            : 'Ya has enviado las 2 pruebas de hoy para esta plantilla. Mañana se reinicia.',
        quota: cupo,
      }, 429)
    }

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
      // Se devuelve el cupo: no ha llegado ningún correo, así que cobrarle
      // la prueba al usuario por un fallo nuestro no tiene sentido. Se borra
      // por identificador; PostgREST no admite LIMIT en un DELETE.
      if (cupo?.test_id) {
        await supabase.from('hub_template_tests').delete().eq('id', cupo.test_id)
      }
      return json({ error: 'No se pudo enviar la prueba' }, 502)
    }

    return json({
      success: true,
      sent_to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      quota: cupo,
    })

  } catch (err) {
    console.error(err)
    return json({ error: err?.message ?? 'Error inesperado' }, 500)
  }
})
