// ============================================================
// TRIMM Hub — Baja de campañas
//
// Atiende dos caminos distintos con la misma URL:
//   · POST → baja en un clic. Es lo que dispara Gmail al pulsar
//     "Cancelar suscripción" en su propia interfaz, sin abrir el navegador.
//     Debe responder rápido y sin contenido.
//   · GET  → la persona ha abierto el enlace del pie del correo. Devuelve
//     una página de confirmación.
//
// Desplegar con --no-verify-jwt: se abre desde un correo, sin sesión.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function page(title: string, message: string, ok: boolean) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    padding:24px; background:#f8fafc; color:#0f172a;
    font-family:'Plus Jakarta Sans',-apple-system,system-ui,sans-serif;
  }
  .card {
    background:#fff; border:1px solid #e2e8f0; border-radius:24px;
    padding:40px 32px; max-width:440px; width:100%; text-align:center;
    box-shadow:0 10px 40px -14px rgba(15,23,42,.14);
  }
  .mark {
    width:56px; height:56px; border-radius:50%; margin:0 auto 20px;
    display:flex; align-items:center; justify-content:center;
    font-size:26px; font-weight:800;
    background:${ok ? '#ecfdf5' : '#fef2f2'}; color:${ok ? '#047857' : '#dc2626'};
  }
  h1 { font-size:20px; font-weight:800; margin:0 0 10px; letter-spacing:-.02em; }
  p { font-size:14px; line-height:1.65; color:#475569; margin:0; }
  .foot { margin-top:26px; font-size:11px; color:#94a3b8; }
  a { color:#1d4ed8; }
  @media (prefers-color-scheme: dark) {
    body { background:#0a1120; color:#e8eefb; }
    .card { background:#111b2e; border-color:#24334d; }
    .mark { background:${ok ? '#0e2420' : '#2a1518'}; color:${ok ? '#52c99a' : '#ff7a70'}; }
    p { color:#a3b3cc; }
    .foot { color:#7f92b0; }
    a { color:#8ab3ff; }
  }
</style></head>
<body>
  <div class="card">
    <div class="mark">${ok ? '✓' : '!'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="foot">TRIMM · Tus citas y recordatorios no se ven afectados.</p>
  </div>
</body></html>`
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('t') ?? url.searchParams.get('token')

  // ── Baja en un clic desde el cliente de correo ──────────────────────
  if (req.method === 'POST') {
    if (!token) return new Response('Missing token', { status: 400 })
    const { data } = await supabase.rpc('hub_unsubscribe_by_token', { p_token: token })
    // Gmail espera 200 sin contenido; un error aquí se traduce en que el
    // botón deje de aparecer, así que respondemos 200 igualmente.
    return new Response(null, { status: data?.success ? 200 : 200 })
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  if (!token) {
    return html(page(
      'Enlace incompleto',
      'Al enlace le falta el identificador. Abre de nuevo el enlace desde el correo original.',
      false,
    ), 400)
  }

  try {
    const { data, error } = await supabase.rpc('hub_unsubscribe_by_token', { p_token: token })

    if (error || !data?.success) {
      return html(page(
        'No hemos podido procesar la baja',
        data?.error === 'Enlace no válido'
          ? 'Este enlace ya no es válido. Puede que la campaña se haya eliminado o que ya te hubieras dado de baja.'
          : 'Ha ocurrido un problema al procesar tu solicitud. Inténtalo de nuevo en unos minutos.',
        false,
      ), 400)
    }

    return html(page(
      'Baja confirmada',
      `<strong>${data.email}</strong> ya no recibirá campañas comerciales de ${data.business_name}. `
      + 'Los recordatorios y confirmaciones de tus citas siguen llegando con normalidad.',
      true,
    ))

  } catch (err) {
    console.error(err)
    return html(page(
      'Algo ha fallado',
      'No hemos podido completar la baja. Inténtalo de nuevo más tarde.',
      false,
    ), 500)
  }
})
