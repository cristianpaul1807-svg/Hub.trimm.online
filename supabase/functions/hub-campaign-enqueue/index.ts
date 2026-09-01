// ============================================================
// TRIMM Hub — Encolar una campaña
//
// Sustituye al antiguo hub-create-campaign-payment. La diferencia de fondo:
// aquí no se cobra nada con tarjeta. Se descuenta saldo de créditos, se
// congela la audiencia en la cola, y el worker se encarga del resto.
//
// Orden de las operaciones (importa):
//   1. crear la campaña en borrador
//   2. materializar la audiencia real  → sabemos cuántos envíos son
//   3. descontar exactamente esos créditos
//   4. despertar al worker
//
// Si el paso 3 falla, se deshace el 2 y la campaña queda cancelada sin
// haber consumido nada.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/campaign.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const MAX_RECIPIENTS_PER_CAMPAIGN = 100_000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let campaignId: string | null = null

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user }, error: authError } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const {
      template_id,
      template_type,
      target_business_ids,
      discount_value,
      max_recipients,
      custom_subject,
      custom_body,
    } = await req.json()

    if (!template_type || !Array.isArray(target_business_ids) || target_business_ids.length === 0) {
      return json({ error: 'Faltan la plantilla o las sucursales objetivo' }, 400)
    }

    const cap = Math.min(
      Number.isFinite(max_recipients) && max_recipients > 0 ? max_recipients : MAX_RECIPIENTS_PER_CAMPAIGN,
      MAX_RECIPIENTS_PER_CAMPAIGN,
    )

    // ── 1. Campaña en borrador ──────────────────────────────────────
    // La plantilla debe ser del sistema o del propio grupo. Sin esta
    // comprobación se podría enviar con la plantilla de otro cliente
    // pasando su identificador.
    let plantillaId: string | null = null
    if (template_id) {
      const { data: tpl } = await supabase
        .from('hub_email_templates')
        .select('id, hub_owner_id, is_system, active')
        .eq('id', template_id)
        .maybeSingle()

      if (!tpl || !tpl.active || (!tpl.is_system && tpl.hub_owner_id !== user.id)) {
        return json({ error: 'La plantilla elegida no está disponible' }, 400)
      }
      plantillaId = tpl.id
    }

    const { data: campaign, error: createErr } = await supabase
      .from('hub_campaigns')
      .insert({
        hub_owner_id: user.id,
        template_id: plantillaId,
        template_type,
        target_business_ids,
        discount_value: template_type === 'discount' ? (discount_value ?? 10) : null,
        custom_subject: custom_subject ?? null,
        custom_body: custom_body ?? null,
        status: 'draft',
      })
      .select('id')
      .single()

    if (createErr || !campaign) {
      console.error('create campaign failed', createErr)
      return json({ error: 'No se pudo crear la campaña' }, 500)
    }
    campaignId = campaign.id

    // ── 2. Congelar la audiencia ────────────────────────────────────
    // hub_materialize_campaign usa la misma función de resolución que la
    // estimación mostrada al usuario, así que el número no puede divergir.
    const { data: queued, error: matErr } = await supabase.rpc('hub_materialize_campaign', {
      p_campaign_id: campaignId,
      p_max_recipients: cap,
    })

    if (matErr) {
      console.error('materialize failed', matErr)
      await supabase.from('hub_campaigns')
        .update({ status: 'failed', failure_reason: matErr.message })
        .eq('id', campaignId)
      return json({ error: matErr.message }, 400)
    }

    const recipients = Number(queued ?? 0)

    if (recipients === 0) {
      await supabase.from('hub_campaigns')
        .update({ status: 'cancelled', failure_reason: 'Sin destinatarios elegibles' })
        .eq('id', campaignId)
      return json({
        error: 'No hay destinatarios elegibles. Puede que ya se hayan dado de baja o no tengan email.',
      }, 400)
    }

    // ── 3. Descontar créditos ───────────────────────────────────────
    const { data: consume, error: consumeErr } = await supabase.rpc('hub_consume_credits', {
      p_hub_owner_id: user.id,
      p_credits: recipients,
      p_campaign_id: campaignId,
      p_reason: 'campaign',
    })

    if (consumeErr || !consume?.success) {
      // Nada se ha enviado todavía: se deshace la cola y la campaña queda
      // cancelada sin coste para el cliente.
      await supabase.from('hub_campaign_recipients').delete().eq('campaign_id', campaignId)
      await supabase.from('hub_campaigns')
        .update({ status: 'cancelled', failure_reason: 'Saldo insuficiente', recipients_count: 0 })
        .eq('id', campaignId)

      return json({
        error: 'Saldo insuficiente',
        available: consume?.available ?? 0,
        required: consume?.required ?? recipients,
        needs_credits: true,
      }, 402)
    }

    await supabase.from('hub_campaigns')
      .update({
        credits_reserved: recipients,
        budget_eur: Number((recipients * 0.01).toFixed(2)),
        price_per_email: 0.01,
      })
      .eq('id', campaignId)

    await supabase.from('hub_campaign_stats').upsert(
      { campaign_id: campaignId, emails_sent: 0, emails_opened: 0, emails_bounced: 0, open_rate: 0 },
      { onConflict: 'campaign_id' },
    )

    // ── 4. Despertar al worker ──────────────────────────────────────
    // Sin await: el envío no debe bloquear la respuesta al navegador. Si
    // esta llamada se pierde, el cron recoge la campaña igualmente.
    fetch(`${SUPABASE_URL}/functions/v1/hub-send-campaign`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId }),
    }).catch((e) => console.error('worker kick failed (el cron lo recogerá)', e))

    return json({
      success: true,
      campaign_id: campaignId,
      recipients,
      credits_spent: recipients,
    })

  } catch (err) {
    console.error(err)
    if (campaignId) {
      await supabase.from('hub_campaigns')
        .update({ status: 'failed', failure_reason: String(err?.message ?? err) })
        .eq('id', campaignId)
    }
    return json({ error: err?.message ?? 'Error inesperado' }, 500)
  }
})
