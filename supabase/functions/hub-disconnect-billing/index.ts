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

    // Get billing info
    const { data: billing } = await supabase
      .from('hub_billing')
      .select('stripe_customer_id, stripe_pm_id')
      .eq('hub_owner_id', user.id)
      .maybeSingle()

    if (billing?.stripe_pm_id) {
      // Detach payment method from customer
      await stripe.paymentMethods.detach(billing.stripe_pm_id)
    }

    // Mark billing as disconnected
    await supabase.from('hub_billing').update({
      stripe_pm_id: null,
      card_brand: null,
      card_last4: null,
      card_exp_month: null,
      card_exp_year: null,
      status: 'disconnected',
      updated_at: new Date().toISOString(),
    }).eq('hub_owner_id', user.id)

    // Pause all active campaigns
    const { data: paused } = await supabase
      .from('hub_campaigns')
      .update({ status: 'paused_no_billing' })
      .eq('hub_owner_id', user.id)
      .in('status', ['draft', 'paid'])
      .select('id')

    return new Response(JSON.stringify({
      success: true,
      campaigns_paused: paused?.length ?? 0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
