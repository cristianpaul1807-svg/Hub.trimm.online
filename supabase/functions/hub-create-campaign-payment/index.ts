import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.11.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PRICE_PER_EMAIL = 0.01 // €0.01 per email

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')!
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const {
      campaign_id,
      budget_eur,
      recipients_count,
      template_type,
      target_business_ids,
      discount_value,
    } = await req.json()

    // Get billing info
    const { data: billing, error: billingError } = await supabase
      .from('hub_billing')
      .select('stripe_customer_id, stripe_pm_id, status')
      .eq('hub_owner_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (billingError || !billing?.stripe_pm_id) {
      return new Response(JSON.stringify({ error: 'No active payment method found' }), { status: 400, headers: corsHeaders })
    }

    const amountCents = Math.round(budget_eur * 100) // Stripe works in cents

    // Create PaymentIntent with off_session (charged immediately)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      customer: billing.stripe_customer_id,
      payment_method: billing.stripe_pm_id,
      confirm: true,
      off_session: true,
      description: `TRIMM Hub — Campaña de email (${recipients_count} destinatarios)`,
      metadata: {
        hub_owner_id: user.id,
        campaign_id: campaign_id ?? 'new',
        template_type,
        recipients_count: String(recipients_count),
      },
    })

    if (paymentIntent.status !== 'succeeded') {
      return new Response(JSON.stringify({ error: 'Payment did not succeed', status: paymentIntent.status }), {
        status: 400, headers: corsHeaders
      })
    }

    // Upsert the campaign record as 'paid'
    const campaignPayload = {
      hub_owner_id: user.id,
      template_type,
      target_business_ids,
      budget_eur,
      price_per_email: PRICE_PER_EMAIL,
      recipients_count,
      discount_value: discount_value ?? null,
      stripe_payment_intent_id: paymentIntent.id,
      status: 'paid',
    }

    let savedCampaignId = campaign_id
    if (campaign_id) {
      await supabase.from('hub_campaigns').update(campaignPayload).eq('id', campaign_id)
    } else {
      const { data: newCampaign } = await supabase.from('hub_campaigns').insert(campaignPayload).select('id').single()
      savedCampaignId = newCampaign?.id
    }

    // Insert initial stats row
    await supabase.from('hub_campaign_stats').upsert({
      campaign_id: savedCampaignId,
      emails_sent: 0, emails_opened: 0, emails_bounced: 0, open_rate: 0,
    }, { onConflict: 'campaign_id' })

    return new Response(JSON.stringify({ success: true, campaign_id: savedCampaignId, payment_intent_id: paymentIntent.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error(err)
    // Handle Stripe card errors
    if (err.type === 'StripeCardError') {
      return new Response(JSON.stringify({ error: 'La tarjeta fue rechazada. Por favor, actualiza tu método de pago.' }), {
        status: 402, headers: corsHeaders
      })
    }
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
