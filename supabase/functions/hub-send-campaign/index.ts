import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL = 'marketing@trimm.online'
const BATCH_SIZE = 50 // Resend batch limit

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Email Templates ──────────────────────────────────────────────────
function buildReengagementEmail(businessName: string, bookingUrl: string) {
  return {
    subject: `${businessName} te echa de menos 💙`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:#1d4ed8;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:24px;font-weight:900">${businessName}</h1>
          <p style="color:#bfdbfe;margin:8px 0 0;font-size:14px">Te echamos de menos</p>
        </div>
        <div style="padding:32px">
          <p style="font-size:16px;color:#374151">¡Hola! Hace tiempo que no te vemos.</p>
          <p style="font-size:14px;color:#6b7280">Reserva tu próxima cita con un solo clic y vuelve a disfrutar de nuestros servicios.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${bookingUrl}" style="background:#1d4ed8;color:#fff;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:900;font-size:14px">Reservar ahora →</a>
          </div>
          <p style="font-size:11px;color:#9ca3af;text-align:center">Powered by TRIMM · <a href="${bookingUrl}/unsubscribe" style="color:#9ca3af">Darse de baja</a></p>
        </div>
      </div>
    `
  }
}

function buildDiscountEmail(businessName: string, bookingUrl: string, discountValue: number) {
  return {
    subject: `${businessName} — ${discountValue}% de descuento exclusivo para ti 🎁`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);padding:40px;text-align:center">
          <p style="color:#bfdbfe;margin:0;font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase">Oferta especial</p>
          <h1 style="color:#fff;margin:8px 0;font-size:56px;font-weight:900;line-height:1">${discountValue}%</h1>
          <p style="color:#c4b5fd;margin:0;font-size:15px">de descuento en ${businessName}</p>
        </div>
        <div style="padding:32px">
          <p style="font-size:14px;color:#6b7280;text-align:center">Esta oferta es exclusiva para ti. Reserva antes de que expire.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${bookingUrl}" style="background:#1d4ed8;color:#fff;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:900;font-size:14px">Reservar con ${discountValue}% dto →</a>
          </div>
          <p style="font-size:11px;color:#9ca3af;text-align:center">Powered by TRIMM · <a href="${bookingUrl}/unsubscribe" style="color:#9ca3af">Darse de baja</a></p>
        </div>
      </div>
    `
  }
}

function buildLoyaltyEmail(businessName: string, loyaltyUrl: string) {
  return {
    subject: `Tu tarjeta de fidelidad en ${businessName} te espera 🪙`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:linear-gradient(135deg,#064e3b,#1d4ed8);padding:40px;text-align:center">
          <div style="font-size:48px;margin-bottom:8px">🪙</div>
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:900">Programa de fidelidad</h1>
          <p style="color:#a7f3d0;margin:8px 0 0;font-size:14px">${businessName}</p>
        </div>
        <div style="padding:32px">
          <p style="font-size:15px;color:#374151;text-align:center">Cada visita suma puntos. Cuantos más puntos, más beneficios exclusivos para ti.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${loyaltyUrl}" style="background:#059669;color:#fff;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:900;font-size:14px">Activar mi tarjeta →</a>
          </div>
          <p style="font-size:11px;color:#9ca3af;text-align:center">Powered by TRIMM · <a href="${loyaltyUrl}/unsubscribe" style="color:#9ca3af">Darse de baja</a></p>
        </div>
      </div>
    `
  }
}

// ── Main Handler ─────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')!
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { campaign_id } = await req.json()

    // Load campaign
    const { data: campaign, error: campErr } = await supabase
      .from('hub_campaigns')
      .select('*')
      .eq('id', campaign_id)
      .eq('hub_owner_id', user.id)
      .eq('status', 'paid')
      .single()

    if (campErr || !campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found or not paid' }), { status: 404, headers: corsHeaders })
    }

    // Mark as sending
    await supabase.from('hub_campaigns').update({ status: 'sending', sent_at: new Date().toISOString() }).eq('id', campaign_id)

    // Get business slugs for URLs
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id, name, slug')
      .in('id', campaign.target_business_ids)

    // Collect unique client emails
    const { data: clients } = await supabase
      .from('clients')
      .select('email, name, business_id')
      .in('business_id', campaign.target_business_ids)
      .not('email', 'is', null)
      .neq('email', '')
      .limit(campaign.recipients_count)

    if (!clients || clients.length === 0) {
      await supabase.from('hub_campaigns').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', campaign_id)
      return new Response(JSON.stringify({ success: true, sent: 0 }), { headers: corsHeaders })
    }

    // Deduplicate emails
    const uniqueClients = Array.from(new Map(clients.map(c => [c.email, c])).values())
    const toSend = uniqueClients.slice(0, campaign.recipients_count)

    let sent = 0
    let bounced = 0

    // Send in batches
    for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
      const batch = toSend.slice(i, i + BATCH_SIZE)

      const emails = batch.map((client) => {
        const biz = businesses?.find(b => b.id === client.business_id) ?? businesses?.[0]
        const bizName = biz?.name ?? 'TRIMM'
        const bookingUrl = `${Deno.env.get('APP_URL') ?? 'https://trimm.online'}/b/${biz?.slug ?? ''}`
        const loyaltyUrl = `${bookingUrl}/loyalty`

        let emailContent
        if (campaign.template_type === 'reengagement') {
          emailContent = buildReengagementEmail(bizName, bookingUrl)
        } else if (campaign.template_type === 'discount') {
          emailContent = buildDiscountEmail(bizName, bookingUrl, campaign.discount_value ?? 10)
        } else {
          emailContent = buildLoyaltyEmail(bizName, loyaltyUrl)
        }

        return {
          from: `${bizName} vía TRIMM <${FROM_EMAIL}>`,
          to: [client.email],
          subject: emailContent.subject,
          html: emailContent.html,
        }
      })

      // Send batch via Resend
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(emails),
      })

      if (res.ok) {
        sent += batch.length
      } else {
        const errBody = await res.json()
        console.error('Resend batch error:', errBody)
        bounced += batch.length
      }
    }

    // Update stats and campaign status
    const openRate = 0 // Real open tracking requires Resend webhooks (future)
    await supabase.from('hub_campaign_stats').upsert({
      campaign_id,
      emails_sent: sent,
      emails_bounced: bounced,
      emails_opened: 0,
      open_rate: openRate,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'campaign_id' })

    await supabase.from('hub_campaigns').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      recipients_count: sent,
    }).eq('id', campaign_id)

    return new Response(JSON.stringify({ success: true, sent, bounced }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
