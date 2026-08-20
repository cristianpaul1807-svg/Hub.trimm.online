// ============================================================
// TRIMM Hub — Ingesta de eventos de Resend
//
// Cierra el bucle de retroalimentación que no existía: entregas, aperturas,
// clics, rebotes y quejas. Los rebotes duros y las quejas de spam entran
// automáticamente en la lista de supresión — es lo único que impide que la
// reputación de envío se degrade campaña tras campaña.
//
// Configurar en Resend → Webhooks, apuntando a:
//   https://<ref>.supabase.co/functions/v1/hub-resend-webhook
// y guardar el secreto en RESEND_WEBHOOK_SECRET.
//
// Esta función debe desplegarse con --no-verify-jwt: la llama Resend, que
// no tiene sesión de Supabase. La autenticidad se comprueba con la firma.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? ''

const TRACKED = new Set([
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.bounced',
  'email.complained',
])

// ── Verificación de firma (esquema Svix, el que usa Resend) ──────────
// Contenido firmado: "<id>.<timestamp>.<cuerpo>", HMAC-SHA256 con el
// secreto en base64, comparado en tiempo constante.
async function verifySignature(
  payload: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
): Promise<boolean> {
  if (!WEBHOOK_SECRET) {
    console.warn('RESEND_WEBHOOK_SECRET no configurado: la firma no se verifica')
    return true
  }
  if (!svixId || !svixTimestamp || !svixSignature) return false

  // Rechaza repeticiones de eventos antiguos.
  const age = Math.abs(Date.now() / 1000 - Number(svixTimestamp))
  if (!Number.isFinite(age) || age > 300) return false

  const secretBytes = Uint8Array.from(
    atob(WEBHOOK_SECRET.replace(/^whsec_/, '')),
    (c) => c.charCodeAt(0),
  )

  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )

  const signed = new TextEncoder().encode(`${svixId}.${svixTimestamp}.${payload}`)
  const mac = await crypto.subtle.sign('HMAC', key, signed)
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))

  // La cabecera puede traer varias firmas separadas por espacios, cada una
  // con el prefijo de versión: "v1,<firma> v1,<firma>".
  return svixSignature.split(' ').some((part) => {
    const value = part.split(',')[1] ?? part
    if (value.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < value.length; i++) {
      diff |= value.charCodeAt(i) ^ expected.charCodeAt(i)
    }
    return diff === 0
  })
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const raw = await req.text()

    const valid = await verifySignature(
      raw,
      req.headers.get('svix-id'),
      req.headers.get('svix-timestamp'),
      req.headers.get('svix-signature'),
    )

    if (!valid) {
      console.error('Firma de webhook inválida')
      return new Response('Invalid signature', { status: 401 })
    }

    const event = JSON.parse(raw)
    const type: string = event?.type ?? ''
    const emailId: string | undefined = event?.data?.email_id ?? event?.data?.id

    if (!TRACKED.has(type)) {
      return new Response(JSON.stringify({ ignored: type }), { status: 200 })
    }

    if (!emailId) {
      console.warn('Evento sin identificador de email:', type)
      return new Response(JSON.stringify({ ignored: 'sin email_id' }), { status: 200 })
    }

    const { data, error } = await supabase.rpc('hub_apply_email_event', {
      p_resend_email_id: emailId,
      p_event_type: type,
    })

    if (error) console.error('hub_apply_email_event falló', error)

    // Siempre 200: un error nuestro no debe hacer que Resend reintente en
    // bucle. Los fallos quedan en el log.
    return new Response(JSON.stringify({ ok: true, result: data ?? null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ ok: false }), { status: 200 })
  }
})
