import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.11.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')!
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { payment_method_id, setup_intent_id } = await req.json()

    // Get the SetupIntent to verify it succeeded
    const setupIntent = await stripe.setupIntents.retrieve(setup_intent_id)
    if (setupIntent.status !== 'succeeded') {
      return new Response(JSON.stringify({ error: 'SetupIntent not succeeded' }), { status: 400, headers: corsHeaders })
    }

    // Get payment method details
    const pm = await stripe.paymentMethods.retrieve(payment_method_id)
    const card = pm.card

    // Update hub_billing with payment method details
    await supabase.from('hub_billing').upsert({
      hub_owner_id: user.id,
      stripe_customer_id: pm.customer as string,
      stripe_pm_id: pm.id,
      card_brand: card?.brand ?? null,
      card_last4: card?.last4 ?? null,
      card_exp_month: card?.exp_month ?? null,
      card_exp_year: card?.exp_year ?? null,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'hub_owner_id' })

    // Reactivate paused campaigns if any
    await supabase
      .from('hub_campaigns')
      .update({ status: 'draft' })
      .eq('hub_owner_id', user.id)
      .eq('status', 'paused_no_billing')

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
