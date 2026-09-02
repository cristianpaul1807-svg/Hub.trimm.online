// ============================================================
// TRIMM Hub — Respuestas HTTP
//
// Vive aparte de campaign.ts porque no tiene nada de campañas: lo usan
// también el cobro de packs y el pago suelto, que no quieren arrastrar las
// claves de Resend ni la validación del remitente solo para responder un
// JSON. Cada función que se despliega lleva consigo los ficheros que
// importa, así que separar esto mantiene los despliegues pequeños.
// ============================================================

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
