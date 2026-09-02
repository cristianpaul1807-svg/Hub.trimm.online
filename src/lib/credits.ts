import { supabase } from './supabase';

// ── Tipos ────────────────────────────────────────────────────────────
export interface CreditSummary {
  total: number;
  plan_credits: number;
  purchased_credits: number;
  plan_expires_at: string | null;
  purchase_expires_at: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  monthly_credits: number;
}

export interface CreditPack {
  id: string;
  code: string;
  name: string;
  description: string | null;
  credits: number;
  price_cents: number;
  currency: string;
  badge: string | null;
  sort_order: number;
}

export interface LedgerEntry {
  id: string;
  delta_credits: number;
  reason: string;
  note: string | null;
  campaign_id: string | null;
  created_at: string;
}

export interface CampaignPerformance {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  open_rate: number;
  click_rate: number;
  bookings: number;
  revenue: number;
  spend: number;
  roi: number | null;
}

export const EMPTY_SUMMARY: CreditSummary = {
  total: 0,
  plan_credits: 0,
  purchased_credits: 0,
  plan_expires_at: null,
  purchase_expires_at: null,
  subscription_tier: null,
  subscription_status: null,
  monthly_credits: 0,
};

// ── Formato ──────────────────────────────────────────────────────────
const nf = new Intl.NumberFormat('es-ES');

export const formatCredits = (n: number) => nf.format(Math.max(0, Math.round(n)));

export const formatEuros = (cents: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
    .format(cents / 100);

export const formatMoney = (euros: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
    .format(euros);

/** Precio por envío del pack, para que el ahorro por volumen sea visible. */
export const pricePerEmail = (pack: CreditPack) => pack.price_cents / 100 / pack.credits;

export function formatPricePerEmail(pack: CreditPack) {
  return `${pricePerEmail(pack).toFixed(4).replace('.', ',')} €`;
}

/** Descuento del pack frente al más caro de la escalera. */
export function savingsPercent(pack: CreditPack, packs: CreditPack[]) {
  const base = Math.max(...packs.map(pricePerEmail));
  if (!base || base <= pricePerEmail(pack)) return 0;
  return Math.round((1 - pricePerEmail(pack) / base) * 100);
}

export function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ── Lectura ──────────────────────────────────────────────────────────
export async function fetchCreditSummary(): Promise<CreditSummary> {
  const { data, error } = await supabase.rpc('hub_credit_summary');
  if (error) throw error;
  return { ...EMPTY_SUMMARY, ...(data ?? {}) };
}

export async function fetchPacks(): Promise<CreditPack[]> {
  const { data, error } = await supabase
    .from('hub_credit_packs')
    .select('*')
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function fetchLedger(limit = 20): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('hub_credit_ledger')
    .select('id, delta_credits, reason, note, campaign_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchPerformance(campaignId: string): Promise<CampaignPerformance | null> {
  const { data, error } = await supabase.rpc('hub_campaign_performance', {
    p_campaign_id: campaignId,
  });
  if (error) throw error;
  return data ?? null;
}

// ── Etiquetas del libro mayor ────────────────────────────────────────
export const LEDGER_LABELS: Record<string, string> = {
  purchase:   'Recarga de saldo',
  plan_grant: 'Envíos incluidos del plan',
  campaign:   'Campaña enviada',
  refund:     'Devolución de envíos no usados',
  expiry:     'Saldo caducado',
  adjustment: 'Ajuste manual',
};

export const LEDGER_ICONS: Record<string, string> = {
  purchase:   'add_card',
  plan_grant: 'card_membership',
  campaign:   'campaign',
  refund:     'undo',
  expiry:     'schedule',
  adjustment: 'tune',
};

// ── Pago suelto de una campaña ──────────────────────────────────────
// El otro camino además de los packs: dices cuánto te gastas y se calcula
// cuántos correos son a la tarifa directa.

export interface CampaignQuote {
  audience: number;
  rate_cents: number;
  min_budget_cents: number;
  max_budget_cents: number;
  budget_cents: number;
  /** Envíos que compra el presupuesto. Es por lo que se cobra. */
  credits: number;
  /** De esos, los que salen en esta campaña. */
  emails: number;
  /** Los comprados que no salen hoy y quedan en el saldo. */
  leftover: number;
  amount_cents: number;
  capped_by_audience: boolean;
  below_minimum: boolean;
  /** Igual que `credits`. Se mantiene por la primera versión de la API. */
  affordable: number;
}

/**
 * Cuántos envíos da un presupuesto.
 *
 * La calcula la base de datos, no el navegador, y el servidor vuelve a
 * pedirla antes de cobrar: si el número se calculara aquí, lo mostrado y lo
 * cobrado podrían no coincidir.
 */
export async function quoteCampaign(
  businessIds: string[],
  templateType: string,
  budgetCents: number,
  daysInactive = 30,
): Promise<CampaignQuote | null> {
  const { data, error } = await supabase.rpc('hub_quote_campaign', {
    p_business_ids: businessIds,
    p_template_type: templateType,
    p_days_inactive: daysInactive,
    p_budget_cents: Math.round(budgetCents),
  });
  if (error) return null;
  return data as CampaignQuote;
}

export interface CheckoutResult {
  success?: boolean;
  requires_action?: boolean;
  client_secret?: string;
  payment_intent_id?: string;
  campaign_id?: string;
  recipients?: number;
  leftover?: number;
  amount_cents?: number;
  quote?: CampaignQuote;
}

/** Fase 1: presupuestar y abrir el cobro. */
export async function startCampaignCheckout(params: {
  templateId?: string | null;
  templateType: string;
  targetBusinessIds: string[];
  discountValue?: number;
  budgetCents: number;
}): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke('hub-campaign-checkout', {
    body: {
      template_id: params.templateId ?? null,
      template_type: params.templateType,
      target_business_ids: params.targetBusinessIds,
      discount_value: params.discountValue,
      budget_cents: Math.round(params.budgetCents),
    },
  });
  if (error && !data) throw new Error('No se pudo contactar con el servicio de pago');
  if (data?.error) throw new Error(data.error);
  return data as CheckoutResult;
}

/** Fase 2: tras confirmar la tarjeta en el navegador. */
export async function finishCampaignCheckout(paymentIntentId: string): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke('hub-campaign-checkout', {
    body: { payment_intent_id: paymentIntentId },
  });
  if (error && !data) throw new Error('No se pudo contactar con el servicio de pago');
  if (data?.error) throw new Error(data.error);
  return data as CheckoutResult;
}
