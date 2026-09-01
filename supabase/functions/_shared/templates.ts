// ============================================================
// TRIMM Hub — Renderizado de plantillas
//
// Convierte una plantilla guardada en base de datos más su contexto en el
// HTML que sale hacia el buzón. Aquí se juntan dos cosas que pueden salir
// caras si se hacen a la ligera:
//
//   · Texto escrito por una persona metido dentro de HTML. Todo lo que
//     venga de la base de datos se escapa antes de pegarlo. Sin eso, un
//     apóstrofo mal puesto rompe el correo y un `<script>` es inyección.
//
//   · HTML de correo. Nada de flexbox ni de hojas de estilo externas: los
//     clientes de correo llevan veinte años atrasados. Tablas, anchos
//     fijos y estilos en línea, que es lo único que aguanta en Outlook.
// ============================================================

export type Layout = 'hero' | 'offer' | 'plain' | 'card'

export interface Template {
  layout: Layout
  subject: string
  preheader?: string | null
  headline?: string | null
  body: string
  cta_label?: string | null
  accent_color?: string | null
  image_url?: string | null
}

export interface Brand {
  logo_url?: string | null
  accent_color?: string | null
  from_name?: string | null
  signature?: string | null
  footer_note?: string | null
}

export interface RenderContext {
  clientName?: string | null
  businessName: string
  discountValue?: number | null
  bookingUrl: string
  unsubscribeUrl: string
}

// ── Escapado ────────────────────────────────────────────────────────
// El orden importa: el ampersand va primero o se re-escaparían las
// entidades que genera el resto.
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * URL segura para un atributo href.
 *
 * Solo http y https. Un `javascript:` en el botón de un correo no se
 * ejecuta en la mayoría de clientes, pero sí en la vista previa del
 * navegador y en los clientes web — y no hay ninguna razón legítima para
 * que una plantilla lleve otro esquema.
 */
export function safeUrl(url: unknown): string {
  const raw = String(url ?? '').trim()
  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return escapeHtml(parsed.toString())
    }
  } catch {
    // No es una URL absoluta; se descarta.
  }
  return ''
}

/**
 * Color válido para un atributo style.
 *
 * La base de datos ya lo restringe con un CHECK, pero esto es lo último
 * que se ejecuta antes de escribirlo en el HTML y no cuesta nada: si el
 * CHECK cambiara o alguien insertara con la clave de servicio, aquí no
 * pasa.
 */
export function safeColor(color: unknown, fallback = '#1d4ed8'): string {
  const raw = String(color ?? '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback
}

// ── Variables ───────────────────────────────────────────────────────
// {{cliente}}, {{negocio}} y {{descuento}}. Se sustituyen sobre el texto
// ya escapado, y los valores se escapan también: el nombre del cliente
// viene de la ficha, que la escribe una persona.
const VARIABLES = ['cliente', 'negocio', 'descuento'] as const

export function fillVariables(text: string, ctx: RenderContext): string {
  const nombre = ctx.clientName?.trim().split(/\s+/)[0]
  const valores: Record<string, string> = {
    cliente: escapeHtml(nombre || 'hola'),
    negocio: escapeHtml(ctx.businessName),
    descuento: escapeHtml(String(ctx.discountValue ?? 10)),
  }
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (coincidencia, clave: string) => {
    const k = clave.toLowerCase()
    // Una variable que no existe se deja tal cual en lugar de vaciarse: así
    // el error se ve en la vista previa en vez de salir un hueco al buzón.
    return k in valores ? valores[k] : coincidencia
  })
}

/** Igual, pero para el asunto, que es texto plano y no lleva HTML. */
export function fillSubject(text: string, ctx: RenderContext): string {
  const nombre = ctx.clientName?.trim().split(/\s+/)[0]
  const valores: Record<string, string> = {
    cliente: nombre || '',
    negocio: ctx.businessName,
    descuento: String(ctx.discountValue ?? 10),
  }
  return text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) =>
      k.toLowerCase() in valores ? valores[k.toLowerCase()] : m)
    .trim()
}

export const VARIABLES_DISPONIBLES = VARIABLES

// ── Piezas ──────────────────────────────────────────────────────────

/** Convierte el cuerpo en párrafos. Los saltos dobles separan; los simples cortan línea. */
function paragraphs(body: string, ctx: RenderContext): string {
  return escapeHtml(body)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      `<p style="font-size:15px;color:#475569;margin:0 0 16px;line-height:1.7;">`
      + fillVariables(p.replace(/\n/g, '<br>'), ctx)
      + `</p>`)
    .join('')
}

function button(label: string, url: string, color: string): string {
  const href = safeUrl(url)
  if (!href) return ''
  // Tabla en lugar de un div: es lo que respeta Outlook.
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 8px;">
    <tr><td align="center" bgcolor="${color}" style="border-radius:100px;">
      <a href="${href}" style="display:inline-block;padding:15px 34px;font-size:14px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:100px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`
}

/** La línea gris que Gmail enseña junto al asunto. Oculta en el cuerpo. */
function preheader(text: string | null | undefined, ctx: RenderContext): string {
  if (!text?.trim()) return ''
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">`
    + fillVariables(escapeHtml(text), ctx)
    + `</div>`
}

function logo(brand: Brand | null | undefined): string {
  const url = safeUrl(brand?.logo_url)
  if (!url) return ''
  return `<img src="${url}" alt="" height="36" style="height:36px;width:auto;display:block;margin:0 auto 18px;border:0;">`
}

function shell(inner: string, ctx: RenderContext, brand: Brand | null | undefined, pre: string): string {
  const unsub = safeUrl(ctx.unsubscribeUrl)
  const firma = brand?.signature?.trim()
  const nota = brand?.footer_note?.trim()

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(ctx.businessName)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f8fafc;">
${pre}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;font-family:'Plus Jakarta Sans',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
${inner}
<tr><td style="padding:22px 32px 28px;border-top:1px solid #e2e8f0;">
  ${firma ? `<p style="font-size:13px;color:#64748b;margin:0 0 14px;line-height:1.6;">${fillVariables(escapeHtml(firma), ctx)}</p>` : ''}
  <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0;line-height:1.7;">
    ${nota ? fillVariables(escapeHtml(nota), ctx) + '<br>' : ''}
    Recibes este correo porque eres cliente de ${escapeHtml(ctx.businessName)}.<br>
    ${unsub ? `<a href="${unsub}" style="color:#64748b;text-decoration:underline;">Darse de baja de estos avisos</a> &nbsp;·&nbsp; ` : ''}Enviado con TRIMM
  </p>
</td></tr>
</table>
</td></tr></table>
</body></html>`
}

// ── Maquetas ────────────────────────────────────────────────────────

function heroLayout(t: Template, ctx: RenderContext, brand: Brand | null | undefined, color: string): string {
  const titular = t.headline?.trim()
  const imagen = safeUrl(t.image_url)
  return `
<tr><td style="background:${color};padding:36px 32px;text-align:center;">
  ${logo(brand)}
  ${titular ? `<h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.02em;line-height:1.3;">${fillVariables(escapeHtml(titular), ctx)}</h1>` : ''}
</td></tr>
${imagen ? `<tr><td style="padding:0;"><img src="${imagen}" alt="" width="600" style="width:100%;max-width:600px;display:block;border:0;"></td></tr>` : ''}
<tr><td style="padding:32px;">
  ${paragraphs(t.body, ctx)}
  ${t.cta_label ? button(fillSubject(t.cta_label, ctx), ctx.bookingUrl, color) : ''}
</td></tr>`
}

function offerLayout(t: Template, ctx: RenderContext, brand: Brand | null | undefined, color: string): string {
  const titular = t.headline?.trim() || `${ctx.discountValue ?? 10}%`
  return `
<tr><td style="background:${color};padding:44px 32px;text-align:center;">
  ${logo(brand)}
  <p style="color:#ffffff;opacity:.75;margin:0;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Oferta exclusiva</p>
  <p style="color:#ffffff;margin:10px 0 4px;font-size:56px;font-weight:800;line-height:1;letter-spacing:-0.04em;">${fillVariables(escapeHtml(titular), ctx)}</p>
  <p style="color:#ffffff;opacity:.85;margin:0;font-size:15px;">${escapeHtml(ctx.businessName)}</p>
</td></tr>
<tr><td style="padding:32px;">
  ${paragraphs(t.body, ctx)}
  ${t.cta_label ? button(fillSubject(t.cta_label, ctx), ctx.bookingUrl, color) : ''}
</td></tr>`
}

function cardLayout(t: Template, ctx: RenderContext, brand: Brand | null | undefined, color: string): string {
  const titular = t.headline?.trim()
  return `
<tr><td style="padding:36px 32px 0;text-align:center;">
  ${logo(brand)}
  ${titular ? `<h1 style="color:#0f172a;margin:0 0 6px;font-size:22px;font-weight:800;letter-spacing:-0.02em;">${fillVariables(escapeHtml(titular), ctx)}</h1>` : ''}
  <p style="color:#94a3b8;margin:0;font-size:13px;font-weight:600;">${escapeHtml(ctx.businessName)}</p>
</td></tr>
<tr><td style="padding:24px 32px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e2e8f0;border-radius:18px;">
    <tr><td style="padding:24px;">
      ${paragraphs(t.body, ctx)}
    </td></tr>
  </table>
  ${t.cta_label ? button(fillSubject(t.cta_label, ctx), ctx.bookingUrl, color) : ''}
</td></tr>`
}

function plainLayout(t: Template, ctx: RenderContext, brand: Brand | null | undefined, color: string): string {
  const titular = t.headline?.trim()
  return `
<tr><td style="padding:36px 32px 0;text-align:center;">${logo(brand)}</td></tr>
<tr><td style="padding:8px 32px 32px;">
  ${titular ? `<h1 style="color:#0f172a;margin:0 0 16px;font-size:20px;font-weight:800;letter-spacing:-0.02em;">${fillVariables(escapeHtml(titular), ctx)}</h1>` : ''}
  ${paragraphs(t.body, ctx)}
  ${t.cta_label ? button(fillSubject(t.cta_label, ctx), ctx.bookingUrl, color) : ''}
</td></tr>`
}

// ── Punto de entrada ────────────────────────────────────────────────
export function renderEmail(
  t: Template,
  ctx: RenderContext,
  brand?: Brand | null,
): { subject: string; html: string } {
  // El color de la plantilla manda sobre el de la marca; si no hay ninguno,
  // el azul de TRIMM.
  const color = safeColor(t.accent_color ?? brand?.accent_color)
  const pre = preheader(t.preheader, ctx)

  let inner: string
  switch (t.layout) {
    case 'offer': inner = offerLayout(t, ctx, brand, color); break
    case 'card':  inner = cardLayout(t, ctx, brand, color);  break
    case 'plain': inner = plainLayout(t, ctx, brand, color); break
    default:      inner = heroLayout(t, ctx, brand, color);
  }

  return {
    subject: fillSubject(t.subject, ctx) || ctx.businessName,
    html: shell(inner, ctx, brand, pre),
  }
}
