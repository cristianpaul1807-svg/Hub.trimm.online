import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.11.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { stripeModeProblem } from '../_shared/stripe.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Una tarjeta guardada en modo de pruebas no sirve para cobrar de verdad:
    // el usuario creería tener método de pago y todos los cobros fallarían.
    const modeProblem = stripeModeProblem()
    if (modeProblem) {
      console.error(modeProblem)
      return new Response(JSON.stringify({ error: modeProblem }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')!
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    // Check if customer already exists in hub_billing
    const { data: billing } = await supabase
      .from('hub_billing')
      .select('stripe_customer_id')
      .eq('hub_owner_id', user.id)
      .maybeSingle()

    let customerId = billing?.stripe_customer_id

    // Create Stripe customer if not exists
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { hub_owner_id: user.id },
      })
      customerId = customer.id
    }

    // Create SetupIntent
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    })

    // Se guarda el cliente de Stripe, pero la facturación NO queda activa
    // hasta que hub-save-payment-method confirme que hay tarjeta de verdad.
    // Marcarla activa aquí hacía que el Hub creyera tener método de pago
    // aunque el usuario cerrara el formulario sin introducir la tarjeta.
    const { data: existing } = await supabase
      .from('hub_billing')
      .select('stripe_pm_id')
      .eq('hub_owner_id', user.id)
      .maybeSingle()

    await supabase.from('hub_billing').upsert({
      hub_owner_id: user.id,
      stripe_customer_id: customerId,
      status: existing?.stripe_pm_id ? 'active' : 'disconnected',
    }, { onConflict: 'hub_owner_id' })

    return new Response(JSON.stringify({
      client_secret: setupIntent.client_secret,
      customer_id: customerId,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
