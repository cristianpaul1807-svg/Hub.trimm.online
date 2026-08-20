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
