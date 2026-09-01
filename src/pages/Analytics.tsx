import { useState, useEffect, useCallback } from 'react';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';
import { supabase } from '../lib/supabase';
import DistributionChart from '../components/charts/DistributionChart';

/**
 * Análisis — de qué está hecho el negocio.
 *
 * Estadísticas dice cómo voy. KPIs dice si voy mejor que antes. Esto dice
 * qué servicios lo sostienen, a qué horas se llena, cuánto sitio libre
 * queda, con cuánta antelación reserva la gente, cómo paga y quién vuelve.
 *
 * Todo lo que se pinta aquí sale de datos que existen de verdad. Lo que en
 * producción está vacío al 100% —depósitos, reprogramaciones, motivos de
 * cancelación, valoraciones— no aparece: un panel de guiones no informa,
 * solo hace ruido.
 */

type Period = 'month' | 'quarter' | 'year';

interface Props {
  selectedBusinessId: string | null;
}

interface Analytics {
  services: Array<{ name: string; appointments: number; revenue: number; avg_price: number; avg_minutes: number }>;
  hours: Array<{ hour: number; appointments: number; revenue: number }>;
  weekdays: Array<{ dow: number; appointments: number; revenue: number; cancelled: number }>;
  occupancy: { booked_minutes: number; capacity_minutes: number; active_staff: number; rate: number | null };
  lead_time: { avg_days: number; buckets: { same_day: number; one_two: number; three_week: number; over_week: number } };
  payments: { methods: Array<{ method: string; appointments: number; revenue: number }>; pending_amount: number };
  clients: { with_visits: number; one_timers: number; repeaters: number; avg_visits: number; avg_spend: number; dormant_60d: number };
  top_clients: Array<{ name: string; visits: number; spend: number; last_visit: string }>;
  notifications: Array<{ type: string; sent: number; failed: number }>;
  loyalty: { active_cards: number; rewards_redeemed: number; discount_given: number; programs_active: number };
}

function getRange(period: Period): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  if (period === 'month') from.setDate(to.getDate() - 30);
  else if (period === 'quarter') from.setDate(to.getDate() - 90);
  else from.setFullYear(to.getFullYear() - 1);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

const euros = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Number(n).toFixed(0));
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
      <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-6">{title}</h3>
      {children}
    </div>
  );
}

function Figure({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className="text-3xl font-black text-slate-900 tracking-tight">{value}</p>
      {help && <p className="text-[11px] font-semibold text-slate-400 mt-1">{help}</p>}
    </div>
  );
}

export default function Analytics({ selectedBusinessId }: Props) {
  const { user } = useHubAuth();
  const { t } = useHubLang();
  const [period, setPeriod] = useState<Period>('quarter');
  const [data, setData] = useState<Analytics | null>(null);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'month', label: t.periods.month },
    { key: 'quarter', label: t.analytics.quarter },
    { key: 'year', label: t.periods.year },
  ];

  const WEEKDAY_LABELS = t.analytics.weekdayShort as string[];

  useEffect(() => {
    if (!user) return;
    supabase
      .from('hub_connections')
      .select('business_id')
      .eq('hub_owner_id', user.id)
      .then(({ data: rows, error: err }) => {
        if (err) { setError(t.errors.loadingError); setLoading(false); return; }
        setLinkedIds((rows ?? []).map((r: any) => r.business_id));
      });
  }, [user, t]);

  const fetchAll = useCallback(async () => {
    if (!linkedIds.length) { setLoading(false); return; }
    setLoading(true);
    setError('');

    const { from, to } = getRange(period);
    const ids = selectedBusinessId ? [selectedBusinessId] : linkedIds;

    const { data: payload, error: err } = await supabase.rpc('get_hub_analytics', {
      p_business_ids: ids,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });

    if (err) {
      console.error('get_hub_analytics:', err.message);
      setError(t.errors.loadingError);
      setData(null);
    } else {
      setData(payload as Analytics);
    }
    setLoading(false);
  }, [linkedIds, period, selectedBusinessId, t]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (!linkedIds.length && !loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8 text-center py-12">
        <div className="w-20 h-20 bg-white border border-slate-200 rounded-2xl flex items-center justify-center text-accent shadow-sm">
          <span className="material-symbols-outlined notranslate text-4xl" translate="no">query_stats</span>
        </div>
        <div className="space-y-3 max-w-sm">
          <h2 className="text-2xl font-black text-slate-900">{t.errors.noData}</h2>
          <p className="text-sm text-slate-500 font-medium">{t.settings.noBusinessesHelper}</p>
        </div>
      </div>
    );
  }

  const occ = data?.occupancy;
  const lead = data?.lead_time;
  const cli = data?.clients;
  const totalServiceRevenue = (data?.services ?? []).reduce((s, x) => s + Number(x.revenue), 0);
  const totalPaid = (data?.payments?.methods ?? []).reduce((s, m) => s + Number(m.revenue), 0);

  const leadBuckets = [
    { label: t.analytics.sameDay, value: lead?.buckets.same_day ?? 0 },
    { label: t.analytics.oneTwo, value: lead?.buckets.one_two ?? 0 },
    { label: t.analytics.threeWeek, value: lead?.buckets.three_week ?? 0 },
    { label: t.analytics.overWeek, value: lead?.buckets.over_week ?? 0 },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center gap-3 flex-wrap">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-200
              ${period === p.key
                ? 'bg-accent text-white shadow-md'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {/* ── Ocupación y antelación ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title={t.analytics.occupancyTitle}>
          {occ?.rate === null || occ?.rate === undefined ? (
            // Sin horario de apertura configurado no hay denominador. Se dice,
            // en lugar de enseñar un 0 % que parecería un negocio parado.
            <p className="text-sm font-bold text-slate-400">{t.analytics.noSchedule}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-end gap-3">
                <p className="text-5xl font-black text-slate-900 tracking-tight">{occ.rate}%</p>
                <p className="text-xs font-bold text-slate-400 mb-2">
                  {Math.round(Number(occ.booked_minutes) / 60)}h / {Math.round(Number(occ.capacity_minutes) / 60)}h
                </p>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(Number(occ.rate), 100)}%` }}
                />
              </div>
              <p className="text-[11px] font-semibold text-slate-400">
                {t.analytics.occupancyHelp.replace('{n}', String(occ.active_staff))}
              </p>
            </div>
          )}
        </Card>

        <Card title={t.analytics.leadTitle}>
          <div className="mb-5">
            <Figure
              label={t.analytics.avgLead}
              value={`${lead?.avg_days ?? 0} ${t.analytics.days}`}
              help={t.analytics.leadHelp}
            />
          </div>
          <div className="space-y-2">
            {leadBuckets.map((b) => {
              const total = leadBuckets.reduce((s, x) => s + x.value, 0);
              return (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-slate-500 w-28 shrink-0">{b.label}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-accent/60 rounded-full" style={{ width: `${pct(b.value, total)}%` }} />
                  </div>
                  <span className="text-xs font-black text-slate-900 w-8 text-right">{b.value}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ── Cuándo se llena ──────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
          {t.analytics.hoursTitle}
        </h3>
        <p className="text-xs font-semibold text-slate-400 -mt-1">{t.analytics.hoursHelp}</p>
        <DistributionChart
          data={(data?.hours ?? []).map((h) => ({ label: `${h.hour}h`, value: h.appointments }))}
          unit={t.metrics.appointments}
          emptyLabel={t.errors.noData}
          loading={loading}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
          {t.analytics.weekdaysTitle}
        </h3>
        <DistributionChart
          data={(data?.weekdays ?? []).map((d) => ({
            label: WEEKDAY_LABELS[d.dow] ?? String(d.dow),
            value: d.appointments,
          }))}
          unit={t.metrics.appointments}
          emptyLabel={t.errors.noData}
          loading={loading}
        />
      </div>

      {/* ── Servicios ────────────────────────────────────────────── */}
      <Card title={t.analytics.servicesTitle}>
        {(data?.services?.length ?? 0) === 0 ? (
          <p className="text-sm font-bold text-slate-400">{t.errors.noData}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[520px]">
              <thead>
                <tr className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                  <th className="pb-3">{t.analytics.service}</th>
                  <th className="pb-3 text-right">{t.metrics.totalRevenue}</th>
                  <th className="pb-3 text-right">{t.kpis.share}</th>
                  <th className="pb-3 text-right">{t.metrics.appointments}</th>
                  <th className="pb-3 text-right">{t.metrics.avgTicket}</th>
                  <th className="pb-3 text-right">{t.analytics.avgDuration}</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {data!.services.map((s) => (
                  <tr key={s.name} className="border-t border-slate-100">
                    <td className="py-3 font-black text-slate-900">{s.name}</td>
                    <td className="py-3 text-right font-black text-slate-900">€{euros(Number(s.revenue))}</td>
                    <td className="py-3 text-right font-bold text-slate-500">
                      {pct(Number(s.revenue), totalServiceRevenue).toFixed(0)}%
                    </td>
                    <td className="py-3 text-right font-bold text-slate-500">{s.appointments}</td>
                    <td className="py-3 text-right font-bold text-slate-500">€{Number(s.avg_price).toFixed(0)}</td>
                    <td className="py-3 text-right font-bold text-slate-500">
                      {Math.round(Number(s.avg_minutes))} min
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Clientes ─────────────────────────────────────────────── */}
      <Card title={t.analytics.clientsTitle}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <Figure label={t.analytics.withVisits} value={String(cli?.with_visits ?? 0)} />
          <Figure label={t.kpis.returningClients} value={String(cli?.repeaters ?? 0)} />
          <Figure label={t.analytics.oneTimers} value={String(cli?.one_timers ?? 0)} />
          <Figure label={t.analytics.avgVisits} value={String(cli?.avg_visits ?? 0)} />
          <Figure
            label={t.analytics.dormant}
            value={String(cli?.dormant_60d ?? 0)}
            help={t.analytics.dormantHelp}
          />
        </div>

        {(data?.top_clients?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[420px]">
              <thead>
                <tr className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                  <th className="pb-3">{t.analytics.topClients}</th>
                  <th className="pb-3 text-right">{t.analytics.visits}</th>
                  <th className="pb-3 text-right">{t.analytics.spend}</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {data!.top_clients.map((c, i) => (
                  <tr key={`${c.name}-${i}`} className="border-t border-slate-100">
                    <td className="py-3 font-black text-slate-900">{c.name}</td>
                    <td className="py-3 text-right font-bold text-slate-500">{c.visits}</td>
                    <td className="py-3 text-right font-black text-slate-900">€{euros(Number(c.spend))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Cobro, avisos y fidelización ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title={t.analytics.paymentsTitle}>
          <div className="space-y-3">
            {(data?.payments?.methods ?? []).map((m) => (
              <div key={m.method} className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">
                  {t.analytics.methods[m.method as keyof typeof t.analytics.methods] ?? m.method}
                </span>
                <span className="text-xs font-black text-slate-900">
                  €{euros(Number(m.revenue))}
                  <span className="text-slate-400 font-bold ml-2">
                    {pct(Number(m.revenue), totalPaid).toFixed(0)}%
                  </span>
                </span>
              </div>
            ))}
            {Number(data?.payments?.pending_amount ?? 0) > 0 && (
              <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-4">
                {t.analytics.pending}: €{euros(Number(data!.payments.pending_amount))}
              </p>
            )}
          </div>
        </Card>

        <Card title={t.analytics.notificationsTitle}>
          <div className="space-y-4">
            {(data?.notifications ?? []).length === 0 && (
              <p className="text-sm font-bold text-slate-400">{t.errors.noData}</p>
            )}
            {(data?.notifications ?? []).map((n) => {
              const total = n.sent + n.failed;
              return (
                <div key={n.type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-600">
                      {t.analytics.notifTypes[n.type as keyof typeof t.analytics.notifTypes] ?? n.type}
                    </span>
                    <span className="text-xs font-black text-slate-900">
                      {pct(n.sent, total).toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${n.failed > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${pct(n.sent, total)}%` }}
                    />
                  </div>
                  {n.failed > 0 && (
                    <p className="text-[11px] font-bold text-amber-700 mt-1">
                      {n.failed} {t.analytics.failed}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title={t.analytics.loyaltyTitle}>
          <div className="grid grid-cols-2 gap-6">
            <Figure label={t.metrics.loyaltyCards} value={String(data?.loyalty?.active_cards ?? 0)} />
            <Figure label={t.analytics.rewards} value={String(data?.loyalty?.rewards_redeemed ?? 0)} />
            <Figure
              label={t.metrics.discounts}
              value={`€${euros(Number(data?.loyalty?.discount_given ?? 0))}`}
            />
            <Figure label={t.analytics.programs} value={String(data?.loyalty?.programs_active ?? 0)} />
          </div>
        </Card>
      </div>
    </div>
  );
}
