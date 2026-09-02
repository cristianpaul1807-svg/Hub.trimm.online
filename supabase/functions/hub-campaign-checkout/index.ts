// ============================================================
// TRIMM Hub — Pagar una campaña suelta
//
// El otro camino además de los packs, el de Instagram y TikTok: dices
// cuánto te quieres gastar, se calcula cuántos correos son a nuestra
// tarifa, se cobra eso y se manda eso.
//
// Dos fases, como la compra de packs:
//
//   Fase 1 — { config de la campaña, budget_cents }
//     Se presupuesta, se crea la campaña en borrador y se abre el cobro.
//     Con tarjeta guardada se cobra fuera de sesión; si el banco pide
//     autenticación, vuelve el client_secret para que lo resuelva el
//     navegador.
//
//   Fase 2 — { payment_intent_id }
//     Tras confirmar. Se verifica contra Stripe que está cobrado de
//     verdad, se acredita, y la campaña sale con el tope exacto de envíos
//     que se han pagado.
//
// Se acredita lo comprado y se envía lo que haya, que no siempre es lo
// mismo: con 5 € se compran 250 envíos aunque solo haya 10 clientes a
// quienes escribir hoy. Los 240 restantes quedan en el saldo. Cobrar solo
// los 10 dejaría un importe de 0,20 €, que Stripe no cobra, y el negocio
// pequeño —el que más necesita la campaña— se quedaría sin poder lanzarla.
//
// El importe NUNCA llega desde el navegador: se recalcula aquí con la
// misma función que vio el usuario. Si viniera del cliente, cualquiera
// pagaría un céntimo por diez mil correos.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.11.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { stripeModeProblem, isLiveObject } from '../_shared/stripe.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Antes de la sesión: si la clave de Stripe no es de producción, aquí no
    // se cobra nada. Mismo criterio que en la compra de packs.
    const modeProblem = stripeModeProblem()
    if (modeProblem) {
      console.error(modeProblem)
      return json({ error: modeProblem }, 503)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user }, error: authError } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json()
    const { payment_intent_id } = body

    // ══ Fase 2: el cobro ya está confirmado ═════════════════════════
    if (payment_intent_id) {
      const pi = await stripe.paymentIntents.retrieve(payment_intent_id)

      // El pago debe ser de este usuario y de este tipo: si no, se podría
      // lanzar una campaña con el cobro de otra persona.
      if (pi.metadata?.hub_owner_id !== user.id || pi.metadata?.kind !== 'campaign_direct') {
        return json({ error: 'El pago no corresponde a esta cuenta' }, 403)
      }
      if (pi.status !== 'succeeded') {
        return json({ error: 'El pago aún no se ha completado', status: pi.status }, 402)
      }
      if (!isLiveObject(pi)) {
        return json({ error: 'Este pago no es de producción' }, 403)
      }

      const campaignId = pi.metadata.campaign_id
      const envios = Number(pi.metadata.emails ?? 0)
      // Si un cobro antiguo no lleva 'credits', lo comprado es lo enviado.
      const creditos = Number(pi.metadata.credits ?? pi.metadata.emails ?? 0)

      if (!campaignId || envios <= 0) {
        return json({ error: 'El pago no lleva la campaña asociada' }, 400)
      }

      return await lanzar(campaignId, envios, creditos, pi.id, pi.amount, user.id)
    }

    // ══ Fase 1: presupuestar y abrir el cobro ═══════════════════════
    const {
      template_id, template_type, target_business_ids,
      discount_value, days_inactive, budget_cents,
    } = body

    if (!template_type || !Array.isArray(target_business_ids) || target_business_ids.length === 0) {
      return json({ error: 'Faltan la plantilla o las sucursales objetivo' }, 400)
    }

    // El presupuesto se recalcula aquí. Lo que diga el navegador sobre el
    // importe es solo lo que se le enseñó: la cifra que se cobra sale de la
    // base de datos, con la misma función.
    //
    // Se llama con el token del usuario, no con la clave de servicio:
    // hub_quote_campaign se apoya en auth.uid() para comprobar que las
    // sucursales son suyas, y con la clave de servicio auth.uid() es nulo.
    // Así la comprobación de acceso sigue siendo la de la base de datos y
    // no una que haya que recordar escribir aquí.
    const comoUsuario = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: cotizacion, error: cotErr } = await comoUsuario.rpc('hub_quote_campaign', {
      p_business_ids: target_business_ids,
      p_template_type: template_type,
      p_days_inactive: days_inactive ?? 30,
      p_budget_cents: Number(budget_cents) || 0,
    })

    if (cotErr) {
      console.error('hub_quote_campaign falló', cotErr)
      return json({ error: cotErr.message }, 400)
    }

    if (cotizacion?.below_minimum) {
      return json({
        error: `El mínimo por campaña son ${(cotizacion.min_budget_cents / 100).toFixed(2)} €`,
        quote: cotizacion,
      }, 400)
    }

    // Dos cifras distintas a propósito: 'credits' es lo que compra el
    // presupuesto y se acredita; 'emails' es lo que sale hoy.
    const envios = Number(cotizacion?.emails ?? 0)
    const creditos = Number(cotizacion?.credits ?? cotizacion?.emails ?? 0)
    const importe = Number(cotizacion?.amount_cents ?? 0)

    if (envios <= 0) {
      return json({
        error: 'No hay destinatarios elegibles para esta campaña.',
        quote: cotizacion,
      }, 400)
    }

    // Stripe rechaza por debajo de 50 céntimos en euros. Se comprueba aquí
    // para dar un mensaje entendible en vez de un error de la pasarela.
    if (importe < 50) {
      return json({ error: 'El importe es demasiado pequeño para cobrarlo' }, 400)
    }

    // ── Campaña en borrador ───────────────────────────────────────
    const { data: campaign, error: createErr } = await supabase
      .from('hub_campaigns')
      .insert({
        hub_owner_id: user.id,
        template_id: template_id ?? null,
        template_type,
        target_business_ids,
        discount_value: template_type === 'discount' ? (discount_value ?? 10) : null,
        status: 'draft',
        price_per_email: Number(cotizacion.rate_cents) / 100,
      })
      .select('id')
      .single()

    if (createErr || !campaign) {
      console.error('create campaign failed', createErr)
      return json({ error: 'No se pudo crear la campaña' }, 500)
    }

    // ── Cliente de Stripe ─────────────────────────────────────────
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

    const conTarjeta = billing?.status === 'active' && !!billing?.stripe_pm_id

    const intent = await stripe.paymentIntents.create({
      amount: importe,
      currency: 'eur',
      customer: customerId,
      description: `TRIMM Hub — Campaña de ${envios.toLocaleString('es-ES')} envíos`,
      metadata: {
        hub_owner_id: user.id,
        kind: 'campaign_direct',
        campaign_id: campaign.id,
        emails: String(envios),
        credits: String(creditos),
      },
      ...(conTarjeta
        ? { payment_method: billing!.stripe_pm_id!, confirm: true, off_session: true }
        : { automatic_payment_methods: { enabled: true } }),
    })

    // Cobrado a la primera con la tarjeta guardada: se lanza ya.
    if (intent.status === 'succeeded') {
      if (!isLiveObject(intent)) {
        return json({ error: 'Este pago no es de producción' }, 403)
      }
      return await lanzar(campaign.id, envios, creditos, intent.id, intent.amount, user.id)
    }

    // El banco pide autenticación, o no había tarjeta: lo resuelve el
    // navegador y vuelve por la fase 2.
    return json({
      success: false,
      requires_action: true,
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
      campaign_id: campaign.id,
      quote: cotizacion,
    })

  } catch (err) {
    console.error(err)

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

/**
 * Acredita lo pagado y lanza la campaña con ese tope exacto.
 *
 * Se acredita en lugar de saltarse el saldo porque toda la maquinaria de
 * envío —reservar, gastar, devolver lo no enviado— ya está construida y
 * probada sobre el saldo. Un segundo camino paralelo sería otro sitio
 * donde equivocarse con el dinero.
 */
async function lanzar(
  campaignId: string,
  envios: number,
  creditos: number,
  paymentIntentId: string,
  importeCents: number,
  ownerId: string,
) {
  // Idempotente sobre el PaymentIntent: si el navegador reintenta la fase 2,
  // no se acredita dos veces.
  const { data: credited, error: credErr } = await supabase.rpc('hub_credit_direct', {
    p_hub_owner_id: ownerId,
    p_credits: Math.max(creditos, envios),
    p_payment_intent: paymentIntentId,
    p_price_cents: importeCents,
  })

  if (credErr || !credited?.success) {
    console.error('hub_credit_direct falló', credErr, credited)
    return json({ error: 'El pago se realizó pero no pudimos acreditarlo. Escríbenos.' }, 500)
  }

  // Si la campaña ya salió (reintento de la fase 2), no se vuelve a lanzar.
  const { data: actual } = await supabase
    .from('hub_campaigns').select('status').eq('id', campaignId).single()

  if (actual && actual.status !== 'draft') {
    return json({ success: true, campaign_id: campaignId, already_sent: true })
  }

  // ── Congelar la audiencia con el tope pagado ──────────────────────
  const { data: queued, error: matErr } = await supabase.rpc('hub_materialize_campaign', {
    p_campaign_id: campaignId,
    p_max_recipients: envios,
  })

  if (matErr) {
    console.error('materialize failed', matErr)
    await supabase.from('hub_campaigns')
      .update({ status: 'failed', failure_reason: matErr.message }).eq('id', campaignId)
    // El saldo se queda acreditado: el dinero es suyo y podrá usarlo en
    // otra campaña. Perderlo por un fallo nuestro sería lo peor.
    return json({ error: matErr.message, credited: true }, 400)
  }

  const encolados = Number(queued ?? 0)

  if (encolados === 0) {
    await supabase.from('hub_campaigns')
      .update({ status: 'cancelled', failure_reason: 'Sin destinatarios elegibles' })
      .eq('id', campaignId)
    return json({
      error: 'No hay destinatarios elegibles. El saldo pagado queda en tu cuenta.',
      credited: true,
    }, 400)
  }

  const { data: consume, error: consumeErr } = await supabase.rpc('hub_consume_credits', {
    p_hub_owner_id: ownerId,
    p_credits: encolados,
    p_campaign_id: campaignId,
    p_reason: 'campaign',
  })

  if (consumeErr || !consume?.success) {
    await supabase.from('hub_campaign_recipients').delete().eq('campaign_id', campaignId)
    await supabase.from('hub_campaigns')
      .update({ status: 'cancelled', failure_reason: 'No se pudo reservar el saldo' })
      .eq('id', campaignId)
    return json({ error: 'No se pudo reservar el saldo', credited: true }, 500)
  }

  await supabase.from('hub_campaigns')
    .update({
      credits_reserved: encolados,
      budget_eur: Number((importeCents / 100).toFixed(2)),
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq('id', campaignId)

  await supabase.from('hub_campaign_stats').upsert(
    { campaign_id: campaignId, emails_sent: 0, emails_opened: 0, emails_bounced: 0, open_rate: 0 },
    { onConflict: 'campaign_id' },
  )

  // Sin await: el envío no bloquea la respuesta. Si esta llamada se pierde,
  // el cron recoge la campaña igualmente.
  fetch(`${SUPABASE_URL}/functions/v1/hub-send-campaign`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign_id: campaignId }),
  }).catch((e) => console.error('worker kick failed (el cron lo recogerá)', e))

  return json({
    success: true,
    campaign_id: campaignId,
    recipients: encolados,
    // Lo comprado y no enviado hoy: la pantalla lo dice para que nadie
    // descubra por su cuenta que le sobró saldo.
    leftover: Math.max(0, Math.max(creditos, envios) - encolados),
    amount_cents: importeCents,
  })
}
