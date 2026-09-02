// ============================================================
// TRIMM Hub — Utilidades compartidas del motor de campañas
// ============================================================

// Se reexportan para no romper a quien ya los importaba de aquí.
export { corsHeaders, json } from './http.ts'

export const APP_URL = Deno.env.get('APP_URL') ?? 'https://trimm.online'
export const HUB_URL = Deno.env.get('HUB_URL') ?? 'https://hub.trimm.online'

// El marketing sale por un subdominio propio para que una queja de spam en
// una campaña nunca degrade la entrega de los recordatorios de citas.
export const MARKETING_FROM =
  Deno.env.get('MARKETING_FROM_EMAIL') ?? 'campanas@marketing.trimm.online'

// Clave de Resend específica de marketing. Si no está configurada se cae a la
// general, pero lo correcto en producción es que sean dos claves distintas.
export const RESEND_KEY =
  Deno.env.get('RESEND_MARKETING_API_KEY') ?? Deno.env.get('RESEND_API_KEY') ?? ''

// Dominio reservado al correo transaccional: recordatorios de cita,
// confirmaciones y códigos de verificación.
export const TRANSACTIONAL_DOMAIN =
  Deno.env.get('TRANSACTIONAL_DOMAIN') ?? 'trimm.online'

/**
 * Impide que una campaña salga por el dominio transaccional.
 *
 * Es el error operativo más caro que se puede cometer aquí: basta con que
 * alguien deje MARKETING_FROM_EMAIL sin configurar, o lo apunte al dominio
 * raíz «porque es el que está verificado», para que las quejas de spam de una
 * campaña comercial empiecen a degradar la entrega de los recordatorios de
 * cita — que es el producto por el que pagan los negocios.
 *
 * Un subdominio propio (marketing.trimm.online) sí vale: mantiene su
 * reputación separada de la del dominio raíz.
 */
export function marketingSenderProblem(): string | null {
  const domain = MARKETING_FROM.split('@')[1]?.toLowerCase().trim()

  if (!domain) {
    return `El remitente de marketing no es una dirección válida: "${MARKETING_FROM}"`
  }

  if (domain === TRANSACTIONAL_DOMAIN.toLowerCase()) {
    return `El remitente de campañas (${MARKETING_FROM}) usa el dominio transaccional `
      + `${TRANSACTIONAL_DOMAIN}. Configura MARKETING_FROM_EMAIL en un subdominio propio `
      + `—por ejemplo campanas@marketing.${TRANSACTIONAL_DOMAIN}— para no arriesgar la `
      + `entrega de los recordatorios de cita.`
  }

  return null
}

export interface Recipient {
  id: string
  client_id: string | null
  business_id: string
  email: string
  client_name: string | null
  unsubscribe_token: string
}

export interface BusinessInfo {
  id: string
  name: string
  slug: string | null
  email: string | null
}

/**
 * A dónde va la respuesta cuando alguien contesta a una campaña.
 *
 * El buzón de marketing.trimm.online no lo lee nadie: la recepción está
 * desactivada a propósito. Pero la gente responde a estos correos — «¿a qué
 * hora abrís?», «quiero cambiar la cita» — y quien debe recibir eso es la
 * peluquería, no TRIMM. El remitente ya sale con su nombre, así que para el
 * cliente la conversación es con su negocio de siempre.
 *
 * Si el negocio no tiene email registrado se devuelve undefined y no se
 * añade la cabecera: mejor que rebote de forma visible a que la respuesta
 * desaparezca en un buzón que nadie abre.
 */
export function replyToFor(biz: BusinessInfo | undefined): string | undefined {
  const email = biz?.email?.trim()
  if (!email || !email.includes('@')) return undefined
  return email
}

// ── Enlaces ──────────────────────────────────────────────────────────
// El enlace de reserva lleva el token del destinatario: es lo que permite
// atribuir la reserva a la campaña que la provocó.
export function bookingUrl(biz: BusinessInfo | undefined, token: string) {
  const base = `${APP_URL}/b/${biz?.slug ?? ''}`
  return `${base}?tc=${token}`
}

// Enlace visible en el pie del correo: dominio propio, que es lo que la
// gente reconoce y lo que no penaliza la reputación.
export function unsubscribeUrl(token: string) {
  return `${HUB_URL}/baja?t=${token}`
}

// Destino de la cabecera List-Unsubscribe. Aquí Gmail hace un POST
// automático sin abrir el navegador, así que tiene que atenderlo la Edge
// Function directamente y no la aplicación de una sola página.
export function unsubscribePostUrl(token: string) {
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  return `${base}/functions/v1/hub-unsubscribe?t=${token}`
}

// ── Plantillas ───────────────────────────────────────────────────────
interface TemplateArgs {
  businessName: string
  bookingUrl: string
  unsubscribeUrl: string
  clientName?: string | null
  discountValue?: number
}

function shell(businessName: string, unsubUrl: string, inner: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f8fafc;">
  <div style="font-family:'Plus Jakarta Sans',Inter,-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0;">
    ${inner}
    <div style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;">
      <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0;line-height:1.6;">
        Recibes este correo porque eres cliente de ${businessName}.<br>
        <a href="${unsubUrl}" style="color:#64748b;text-decoration:underline;">Darse de baja de estos avisos</a>
        &nbsp;·&nbsp; Enviado con TRIMM
      </p>
    </div>
  </div>
</body></html>`
}

function greeting(name?: string | null) {
  const first = name?.trim().split(/\s+/)[0]
  return first ? `¡Hola, ${first}!` : '¡Hola!'
}

export function buildReengagement(a: TemplateArgs) {
  return {
    subject: `${a.businessName} te echa de menos`,
    html: shell(a.businessName, a.unsubscribeUrl, `
      <div style="background:#1d4ed8;padding:36px 32px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.02em;">${a.businessName}</h1>
        <p style="color:#bfdbfe;margin:8px 0 0;font-size:14px;">Hace tiempo que no nos vemos</p>
      </div>
      <div style="padding:32px;">
        <p style="font-size:16px;color:#0f172a;margin:0 0 12px;font-weight:600;">${greeting(a.clientName)}</p>
        <p style="font-size:14px;color:#475569;margin:0;line-height:1.7;">
          Nos hemos dado cuenta de que hace un tiempo que no pasas por aquí.
          Tu sitio sigue esperándote — reservar te lleva menos de un minuto.
        </p>
        <div style="text-align:center;margin:32px 0 8px;">
          <a href="${a.bookingUrl}" style="background:#1d4ed8;color:#fff;padding:15px 34px;border-radius:100px;text-decoration:none;font-weight:800;font-size:14px;display:inline-block;">Reservar mi cita</a>
        </div>
      </div>`),
  }
}

export function buildDiscount(a: TemplateArgs) {
  const pct = a.discountValue ?? 10
  return {
    subject: `${pct}% de descuento para ti en ${a.businessName}`,
    html: shell(a.businessName, a.unsubscribeUrl, `
      <div style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);padding:44px 32px;text-align:center;">
        <p style="color:#bfdbfe;margin:0;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Oferta exclusiva</p>
        <h1 style="color:#fff;margin:10px 0 4px;font-size:58px;font-weight:800;line-height:1;letter-spacing:-0.04em;">${pct}%</h1>
        <p style="color:#ddd6fe;margin:0;font-size:15px;">de descuento en ${a.businessName}</p>
      </div>
      <div style="padding:32px;">
        <p style="font-size:16px;color:#0f172a;margin:0 0 12px;font-weight:600;">${greeting(a.clientName)}</p>
        <p style="font-size:14px;color:#475569;margin:0;line-height:1.7;">
          Hemos guardado un ${pct}% de descuento a tu nombre para tu próxima visita.
          Se aplica automáticamente al reservar desde este correo.
        </p>
        <div style="text-align:center;margin:32px 0 8px;">
          <a href="${a.bookingUrl}" style="background:#1d4ed8;color:#fff;padding:15px 34px;border-radius:100px;text-decoration:none;font-weight:800;font-size:14px;display:inline-block;">Reservar con ${pct}% dto.</a>
        </div>
      </div>`),
  }
}

export function buildLoyalty(a: TemplateArgs) {
  return {
    subject: `Tu tarjeta de fidelidad en ${a.businessName}`,
    html: shell(a.businessName, a.unsubscribeUrl, `
      <div style="background:linear-gradient(135deg,#064e3b,#1d4ed8);padding:44px 32px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">Programa de fidelidad</h1>
        <p style="color:#a7f3d0;margin:8px 0 0;font-size:14px;">${a.businessName}</p>
      </div>
      <div style="padding:32px;">
        <p style="font-size:16px;color:#0f172a;margin:0 0 12px;font-weight:600;">${greeting(a.clientName)}</p>
        <p style="font-size:14px;color:#475569;margin:0;line-height:1.7;">
          Cada visita suma puntos, y cada cierto número de puntos te llevas una
          recompensa. Activar tu tarjeta es gratis y solo se hace una vez.
        </p>
        <div style="text-align:center;margin:32px 0 8px;">
          <a href="${a.bookingUrl}" style="background:#059669;color:#fff;padding:15px 34px;border-radius:100px;text-decoration:none;font-weight:800;font-size:14px;display:inline-block;">Activar mi tarjeta</a>
        </div>
      </div>`),
  }
}

export function renderTemplate(
  templateType: string,
  args: TemplateArgs,
): { subject: string; html: string } {
  if (templateType === 'reengagement') return buildReengagement(args)
  if (templateType === 'loyalty') return buildLoyalty(args)
  return buildDiscount(args)
}

// ── Cabeceras de baja en un clic ─────────────────────────────────────
// Gmail las exige a los remitentes masivos. Sin ellas, el correo acaba en
// la carpeta de spam por muy limpia que esté la lista.
export function unsubscribeHeaders(token: string) {
  return {
    'List-Unsubscribe': `<${unsubscribePostUrl(token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
