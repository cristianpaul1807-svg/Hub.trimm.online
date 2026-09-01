// ============================================================
// TRIMM Hub — Eventos de Stripe
//
// Existe por un agujero concreto: el saldo sólo se acreditaba si el
// navegador volvía a llamar después de pagar. Cerrar la pestaña, perder
// cobertura o quedarse sin batería justo tras confirmar el pago dejaba el
// cobro hecho y el saldo sin acreditar.
//
// Ahora Stripe nos lo cuenta directamente. hub_credit_purchase es
// idempotente sobre el PaymentIntent, así que el navegador y el webhook
// pueden acreditar los dos: gana quien llegue primero y el segundo no
// duplica nada.
//
// La cuenta de Stripe es la misma que la de Trimm, así que por aquí pasan
// también los cobros de las suscripciones Pro. Todo lo que no lleve
// nuestra marca en los metadatos se ignora sin tocarlo.
//
// Desplegar con --no-verify-jwt: la llama Stripe, que no tiene sesión de
// Supabase. La autenticidad se comprueba con la firma.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.11.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

// En Deno la verificación de firma tiene que ser asíncrona: usa WebCrypto
// en lugar del módulo crypto de Node.
const cryptoProvider = Stripe.createSubtleCryptoProvider()

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const WEBHOOK_SECRET = Deno.env.get('STRIPE_HUB_WEBHOOK_SECRET') ?? ''

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Sin secreto no se procesa nada. Aquí no vale el «avisa y sigue»: este
  // webhook regala saldo y retira saldo, así que un POST inventado por
  // cualquiera que conozca la URL saldría caro.
  if (!WEBHOOK_SECRET) {
    console.error('STRIPE_HUB_WEBHOOK_SECRET no configurado: no se procesa el evento')
    return new Response(JSON.stringify({ error: 'Webhook sin configurar' }), { status: 503 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  const raw = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      raw, signature, WEBHOOK_SECRET, undefined, cryptoProvider,
    )
  } catch (err) {
    console.error('Firma de Stripe inválida:', err?.message)
    return new Response('Invalid signature', { status: 400 })
  }

  try {
    switch (event.type) {
      // ── El cobro salió bien ─────────────────────────────────────────
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent
        const ownerId = pi.metadata?.hub_owner_id
        const packCode = pi.metadata?.pack_code

        // Un cobro de Trimm, o cualquier otro que no sea una compra de
        // packs del Hub. No es nuestro: no se toca.
        if (!ownerId || !packCode) {
          return ok({ ignored: 'sin metadatos del Hub' })
        }

        // El prefijo de la clave ya se comprueba al cobrar; aquí se mira el
        // objeto en sí, que es lo que de verdad dice si hubo dinero.
        if (pi.livemode !== true) {
          console.error('PaymentIntent de pruebas recibido en producción:', pi.id)
          return ok({ ignored: 'no es de producción' })
        }

        const { data, error } = await supabase.rpc('hub_credit_purchase', {
          p_hub_owner_id: ownerId,
          p_pack_code: packCode,
          p_payment_intent: pi.id,
        })

        if (error) {
          // Devolver 500 hace que Stripe reintente, que es justo lo que
          // queremos: el cliente ha pagado y hay que acreditarle el saldo.
          console.error('hub_credit_purchase falló', error)
          return new Response(JSON.stringify({ error: error.message }), { status: 500 })
        }

        // 'duplicate' significa que el navegador llegó antes. Es el camino
        // normal, no un problema.
        console.log('Saldo acreditado por webhook', pi.id, JSON.stringify(data))
        return ok({ credited: data })
      }

      // ── Devolución o disputa: se retira lo no gastado ────────────────
      case 'charge.refunded':
      case 'charge.dispute.created': {
        const charge = event.type === 'charge.refunded'
          ? event.data.object as Stripe.Charge
          : (event.data.object as Stripe.Dispute).charge

        const chargeId = typeof charge === 'string' ? charge : charge?.id
        let paymentIntentId: string | null = typeof charge === 'string'
          ? null
          : (typeof charge?.payment_intent === 'string' ? charge.payment_intent : null)

        // En las disputas el cargo llega como identificador: hay que
        // pedirlo para saber a qué PaymentIntent pertenece.
        if (!paymentIntentId && chargeId) {
          const full = await stripe.charges.retrieve(chargeId)
          paymentIntentId = typeof full.payment_intent === 'string' ? full.payment_intent : null
        }

        if (!paymentIntentId) return ok({ ignored: 'cargo sin PaymentIntent' })

        const reason = event.type === 'charge.dispute.created' ? 'chargeback' : 'refund'

        const { data, error } = await supabase.rpc('hub_revoke_purchase', {
          p_payment_intent: paymentIntentId,
          p_reason: reason,
          p_note: `Stripe: ${event.type}`,
        })

        if (error) {
          console.error('hub_revoke_purchase falló', error)
          return new Response(JSON.stringify({ error: error.message }), { status: 500 })
        }

        // not_found es lo normal aquí: la mayoría de devoluciones de esta
        // cuenta serán de Trimm y no tienen lote en el Hub.
        console.log('Retirada de saldo', paymentIntentId, JSON.stringify(data))
        return ok({ revoked: data })
      }

      default:
        return ok({ ignored: event.type })
    }
  } catch (err) {
    console.error(err)
    // 500 para que Stripe reintente: es mejor repetir un evento idempotente
    // que perderlo.
    return new Response(JSON.stringify({ error: err?.message ?? 'Error inesperado' }), {
      status: 500,
    })
  }
})

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
