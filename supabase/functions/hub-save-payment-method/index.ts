// ============================================================
// TRIMM Hub — Guardar el método de pago
//
// Se llama después de que Stripe Elements confirme el SetupIntent en el
// navegador. El servidor vuelve a leer la tarjeta desde Stripe: nunca se
// fía de lo que diga el cliente.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.11.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user }, error: authError } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { payment_method_id, setup_intent_id } = await req.json()
    if (!payment_method_id) return json({ error: 'Falta el método de pago' }, 400)

    // El cliente de Stripe del usuario lo dicta nuestra base de datos, no la
    // petición: así una tarjeta ajena no puede acabar asociada a esta cuenta.
    const { data: billing } = await supabase
      .from('hub_billing')
      .select('stripe_customer_id')
      .eq('hub_owner_id', user.id)
      .maybeSingle()

    if (!billing?.stripe_customer_id) {
      return json({ error: 'No hay una sesión de pago iniciada para esta cuenta' }, 400)
    }

    const pm = await stripe.paymentMethods.retrieve(payment_method_id)

    if (pm.customer && pm.customer !== billing.stripe_customer_id) {
      return json({ error: 'Este método de pago no pertenece a tu cuenta' }, 403)
    }

    // El SetupIntent es opcional: cuando llega, se comprueba que realmente
    // se completó y que corresponde a este mismo cliente.
    if (setup_intent_id) {
      const si = await stripe.setupIntents.retrieve(setup_intent_id)
      if (si.status !== 'succeeded' || si.customer !== billing.stripe_customer_id) {
        return json({ error: 'La validación de la tarjeta no se completó' }, 400)
      }
    }

    // Si Elements no lo asoció ya, se asocia aquí para poder cobrar fuera
    // de sesión más adelante.
    if (!pm.customer) {
      await stripe.paymentMethods.attach(pm.id, { customer: billing.stripe_customer_id })
    }

    const card = pm.card

    await supabase.from('hub_billing').upsert({
      hub_owner_id: user.id,
      stripe_customer_id: billing.stripe_customer_id,
      stripe_pm_id: pm.id,
      card_brand: card?.brand ?? null,
      card_last4: card?.last4 ?? null,
      card_exp_month: card?.exp_month ?? null,
      card_exp_year: card?.exp_year ?? null,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'hub_owner_id' })

    return json({
      success: true,
      card: { brand: card?.brand, last4: card?.last4 },
    })

  } catch (err) {
    console.error(err)
    return json({ error: err?.message ?? 'Error inesperado' }, 500)
  }
})
