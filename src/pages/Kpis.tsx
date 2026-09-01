import { useState, useEffect, useCallback } from 'react';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';
import { supabase } from '../lib/supabase';
import MetricCard from '../components/MetricCard';
import RevenueChart from '../components/charts/RevenueChart';

/**
 * KPIs — la otra mitad de Estadísticas.
 *
 * Estadísticas responde «cómo voy ahora». Esta pantalla responde las dos
 * preguntas que Estadísticas no puede: «¿voy mejor o peor que antes?» y
 * «¿cuál de mis locales tira del grupo?». Por eso todo aquí está en
 * comparación: cada cifra lleva su variación contra el mismo número de días
 * inmediatamente anteriores, hay doce meses de tendencia detrás, y el
 * desglose por sucursal ordena de la que más factura a la que menos.
 */

type Period = 'week' | 'month' | 'year';

interface KpisProps {
  selectedBusinessId: string | null;
}

interface Snapshot {
  revenue: number;
  completed: number;
  cancelled: number;
  avg_ticket: number;
  clients: number;
  returning?: number;
  new_clients?: number;
}

interface Branch {
  business_id: string;
  name: string;
  revenue: number;
  completed: number;
  cancelled: number;
  avg_ticket: number;
}

interface KpiPayload {
  current: Snapshot;
  previous: Snapshot;
  months: Array<{ month: string; revenue: number; completed: number }>;
  branches: Branch[];
}

function getRange(period: Period): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  if (period === 'week') from.setDate(to.getDate() - 7);
  else if (period === 'month') from.setDate(to.getDate() - 30);
  else from.setFullYear(to.getFullYear() - 1);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * Variación porcentual contra el periodo anterior.
 *
 * Devuelve null cuando antes no había nada: un salto de 0 a 5 no es un
 * "+500%", es simplemente que antes no había con qué comparar, y enseñar un
 * porcentaje inventado ahí es peor que no enseñar nada.
 */
function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function euros(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
}

function rate(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export default function Kpis({ selectedBusinessId }: KpisProps) {
  const { user } = useHubAuth();
  const { t } = useHubLang();
  const [period, setPeriod] = useState<Period>('month');
  const [data, setData] = useState<KpiPayload | null>(null);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'week', label: t.periods.week },
    { key: 'month', label: t.periods.month },
    { key: 'year', label: t.periods.year },
  ];

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

  const fetchKpis = useCallback(async () => {
    if (!linkedIds.length) { setLoading(false); return; }
    setLoading(true);
    setError('');

    const { from, to } = getRange(period);
    const ids = selectedBusinessId ? [selectedBusinessId] : linkedIds;

    const { data: payload, error: err } = await supabase.rpc('get_hub_kpis', {
      p_business_ids: ids,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });

    // El error se enseña en lugar de dejar la pantalla en blanco: una pantalla
    // vacía se confunde con "no tienes datos", que es lo contrario de lo que
    // pasa cuando la consulta falla.
    if (err) {
      console.error('get_hub_kpis:', err.message);
      setError(t.errors.loadingError);
      setData(null);
    } else {
      setData(payload as KpiPayload);
    }
    setLoading(false);
  }, [linkedIds, period, selectedBusinessId, t]);

  useEffect(() => { fetchKpis(); }, [fetchKpis]);

  if (!linkedIds.length && !loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8 text-center py-12">
        <div className="w-20 h-20 bg-white border border-slate-200 rounded-2xl flex items-center justify-center text-accent shadow-sm">
          <span className="material-symbols-outlined notranslate text-4xl" translate="no">insights</span>
        </div>
        <div className="space-y-3 max-w-sm">
          <h2 className="text-2xl font-black text-slate-900">{t.errors.noData}</h2>
          <p className="text-sm text-slate-500 font-medium">{t.settings.noBusinessesHelper}</p>
        </div>
      </div>
    );
  }

  const cur = data?.current;
  const prev = data?.previous;

  const cancelRateNow = rate(cur?.cancelled ?? 0, (cur?.completed ?? 0) + (cur?.cancelled ?? 0));
  const cancelRatePrev = rate(prev?.cancelled ?? 0, (prev?.completed ?? 0) + (prev?.cancelled ?? 0));

  const cards = [
    {
      label: t.metrics.totalRevenue,
      value: `€${euros(cur?.revenue ?? 0)}`,
      delta: delta(cur?.revenue ?? 0, prev?.revenue ?? 0),
      icon: 'payments',
    },
    {
      label: t.metrics.appointments,
      value: String(cur?.completed ?? 0),
      delta: delta(cur?.completed ?? 0, prev?.completed ?? 0),
      icon: 'calendar_month',
    },
    {
      label: t.metrics.avgTicket,
      value: `€${(cur?.avg_ticket ?? 0).toFixed(0)}`,
      delta: delta(cur?.avg_ticket ?? 0, prev?.avg_ticket ?? 0),
      icon: 'receipt_long',
    },
    {
      // Aquí subir es malo, de ahí invertDelta.
      label: t.kpis.cancellationRate,
      value: `${cancelRateNow.toFixed(1)}%`,
      delta: delta(cancelRateNow, cancelRatePrev),
      icon: 'event_busy',
      invert: true,
    },
  ];

  const trend = (data?.months ?? []).map((m) => {
    const month = Number(m.month.slice(5, 7)) - 1;
    return { date: MONTH_LABELS[month] ?? m.month, total: Number(m.revenue) || 0 };
  });

  const totalRevenue = (data?.branches ?? []).reduce((sum, b) => sum + Number(b.revenue || 0), 0);
  const returning = cur?.returning ?? 0;
  const distinctClients = cur?.clients ?? 0;
  const retention = rate(returning, distinctClients);

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
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
          {t.kpis.comparedTo}
        </span>
      </div>

      {error && (
        <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((c, i) => (
          <MetricCard
            key={i}
            label={c.label}
            value={c.value}
            delta={c.delta}
            deltaLabel={t.metrics.vsPrevious}
            invertDelta={c.invert}
            icon={c.icon}
            loading={loading}
          />
        ))}
      </div>

      {/* Captar frente a fidelizar: el mismo número de citas significa cosas
          muy distintas según venga de gente nueva o de gente que vuelve. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-6">
          {t.kpis.clientsTitle}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">
              {t.metrics.newClients}
            </p>
            <p className="text-3xl font-black text-slate-900 tracking-tight">
              {loading ? '—' : (cur?.new_clients ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">
              {t.kpis.returningClients}
            </p>
            <p className="text-3xl font-black text-slate-900 tracking-tight">
              {loading ? '—' : returning}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">
              {t.kpis.retention}
            </p>
            <p className="text-3xl font-black text-slate-900 tracking-tight">
              {loading ? '—' : `${retention.toFixed(0)}%`}
            </p>
            <p className="text-[11px] font-semibold text-slate-400 mt-1">
              {t.kpis.retentionHelp}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
          {t.kpis.trendTitle}
        </h3>
        <RevenueChart data={trend} loading={loading} />
      </div>

      {/* Con una sola sucursal el desglose no aporta nada sobre las tarjetas
          de arriba; se enseña solo cuando hay algo que comparar. */}
      {(data?.branches?.length ?? 0) > 1 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-6">
            {t.kpis.branchesTitle}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[520px]">
              <thead>
                <tr className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                  <th className="pb-3">{t.workers.branch}</th>
                  <th className="pb-3 text-right">{t.metrics.totalRevenue}</th>
                  <th className="pb-3 text-right">{t.kpis.share}</th>
                  <th className="pb-3 text-right">{t.metrics.appointments}</th>
                  <th className="pb-3 text-right">{t.metrics.avgTicket}</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {data!.branches.map((b) => (
                  <tr key={b.business_id} className="border-t border-slate-100">
                    <td className="py-3 font-black text-slate-900">{b.name}</td>
                    <td className="py-3 text-right font-black text-slate-900">€{euros(Number(b.revenue))}</td>
                    <td className="py-3 text-right font-bold text-slate-500">
                      {rate(Number(b.revenue), totalRevenue).toFixed(0)}%
                    </td>
                    <td className="py-3 text-right font-bold text-slate-500">{b.completed}</td>
                    <td className="py-3 text-right font-bold text-slate-500">
                      €{Number(b.avg_ticket).toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
