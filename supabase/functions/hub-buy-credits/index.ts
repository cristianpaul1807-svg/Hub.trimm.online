// ============================================================
// TRIMM Hub — Compra de packs de créditos
//
// Dos fases, para cubrir tanto el pago con tarjeta ya guardada como el que
// necesita autenticación del banco:
//
//   Fase 1 — { pack_code }
//     Con tarjeta guardada: se cobra fuera de sesión y se acredita el saldo
//     en el momento. Si el banco pide autenticación, se devuelve el
//     client_secret para que el navegador la resuelva.
//     Sin tarjeta guardada: se devuelve el client_secret directamente.
//
//   Fase 2 — { pack_code, payment_intent_id }
//     Tras confirmar en el navegador. Se verifica contra Stripe que el pago
//     está realmente cobrado antes de acreditar nada.
//
// hub_credit_purchase es idempotente sobre el PaymentIntent, así que
// repetir la fase 2 no duplica el saldo.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.11.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/campaign.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user }, error: authError } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { pack_code, payment_intent_id } = await req.json()
    if (!pack_code) return json({ error: 'Falta el pack' }, 400)

    const { data: pack } = await supabase
      .from('hub_credit_packs')
      .select('*').eq('code', pack_code).eq('active', true).maybeSingle()

    if (!pack) return json({ error: 'Pack no disponible' }, 404)

    // ── Fase 2: finalizar un pago ya confirmado en el navegador ───────
    if (payment_intent_id) {
      const pi = await stripe.paymentIntents.retrieve(payment_intent_id)

      // El PaymentIntent debe ser de este usuario y de este pack: si no, se
      // podría acreditar saldo con el pago de otra persona.
      if (pi.metadata?.hub_owner_id !== user.id || pi.metadata?.pack_code !== pack_code) {
        return json({ error: 'El pago no corresponde a esta cuenta' }, 403)
      }
      if (pi.status !== 'succeeded') {
        return json({ error: 'El pago aún no se ha completado', status: pi.status }, 402)
      }

      const { data: granted } = await supabase.rpc('hub_credit_purchase', {
        p_hub_owner_id: user.id,
        p_pack_code: pack_code,
        p_payment_intent: pi.id,
      })

      return json({ success: true, ...granted })
    }

    // ── Fase 1: iniciar el cobro ──────────────────────────────────────
    const { data: billing } = await supabase
      .from('hub_billing')
      .select('stripe_customer_id, stripe_pm_id, status')
      .eq('hub_owner_id', user.id).maybeSingle()

    let customerId = billing?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { hub_owner_id: user.id },
      })
      customerId = customer.id
      await supabase.from('hub_billing').upsert({
        hub_owner_id: user.id,
        stripe_customer_id: customerId,
        status: 'disconnected',
      }, { onConflict: 'hub_owner_id' })
    }

    const hasSavedCard = billing?.status === 'active' && !!billing?.stripe_pm_id

    const intent = await stripe.paymentIntents.create({
      amount: pack.price_cents,
      currency: pack.currency ?? 'eur',
      customer: customerId,
      description: `TRIMM Hub — Pack ${pack.name} (${pack.credits.toLocaleString('es-ES')} envíos)`,
      metadata: {
        hub_owner_id: user.id,
        pack_code: pack.code,
        credits: String(pack.credits),
      },
      ...(hasSavedCard
        ? { payment_method: billing!.stripe_pm_id!, confirm: true, off_session: true }
        : { automatic_payment_methods: { enabled: true } }),
    })

    if (intent.status === 'succeeded') {
      const { data: granted } = await supabase.rpc('hub_credit_purchase', {
        p_hub_owner_id: user.id,
        p_pack_code: pack.code,
        p_payment_intent: intent.id,
      })
      return json({ success: true, ...granted })
    }

    // El banco pide autenticación, o no había tarjeta guardada: que lo
    // resuelva el navegador y vuelva por la fase 2.
    return json({
      success: false,
      requires_action: true,
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
    })

  } catch (err) {
    console.error(err)

    // Un rechazo con tarjeta guardada trae su propio PaymentIntent, que el
    // navegador puede reintentar con autenticación.
    if (err?.type === 'StripeCardError') {
      return json({
        error: 'La tarjeta fue rechazada. Prueba con otra o actualiza tus datos de pago.',
        requires_action: !!err?.raw?.payment_intent?.client_secret,
        client_secret: err?.raw?.payment_intent?.client_secret ?? null,
        payment_intent_id: err?.raw?.payment_intent?.id ?? null,
      }, 402)
    }

    return json({ error: err?.message ?? 'Error inesperado' }, 500)
  }
})
