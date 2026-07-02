import React, { useState, useEffect, useCallback } from 'react';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';
import { supabase } from '../lib/supabase';
import AppointmentsChart from '../components/charts/AppointmentsChart';

type Period = 'today' | 'week' | 'month' | 'year';
type Metric = 'revenue' | 'appointments' | 'avg_ticket' | 'cancellations';

function getPeriodRange(period: Period, offset = 0): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  let from = new Date(now);
  if (period === 'today') { from.setHours(0, 0, 0, 0); }
  else if (period === 'week') { from.setDate(now.getDate() - 7); }
  else if (period === 'month') { from.setDate(1); from.setHours(0, 0, 0, 0); }
  else { from.setFullYear(now.getFullYear(), 0, 1); from.setHours(0, 0, 0, 0); }
  if (offset) {
    const diff = to.getTime() - from.getTime();
    to.setTime(from.getTime());
    from.setTime(from.getTime() - diff);
  }
  return { from, to };
}

interface BranchStat {
  business_id: string;
  business_name: string;
  revenue: number;
  appointments: number;
  avg_ticket: number;
  cancellations: number;
}

export default function Comparator() {
  const { user } = useHubAuth();
  const { t } = useHubLang();
  const [period, setPeriod] = useState<Period>('week');
  const [metric, setMetric] = useState<Metric>('revenue');
  const [stats, setStats] = useState<BranchStat[]>([]);
  const [prevStats, setPrevStats] = useState<BranchStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'today', label: t.periods.today },
    { key: 'week', label: t.periods.week },
    { key: 'month', label: t.periods.month },
    { key: 'year', label: t.periods.year },
  ];

  const METRICS: { key: Metric; label: string }[] = [
    { key: 'revenue', label: t.comparator.revenue },
    { key: 'appointments', label: t.comparator.appointments },
    { key: 'avg_ticket', label: t.comparator.avgTicket },
    { key: 'cancellations', label: t.comparator.cancellations },
  ];

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from('hub_connections')
        .select('business_id, businesses(name)')
        .eq('hub_owner_id', user.id);
      if (data) setLinkedIds(data.map((d: any) => d.business_id));
    };
    fetch();
  }, [user]);

  const fetchComparator = useCallback(async () => {
    if (!linkedIds.length) { setLoading(false); return; }
    setLoading(true);
    try {
      const { from: f1, to: t1 } = getPeriodRange(period);
      const { from: f2, to: t2 } = getPeriodRange(period, 1);

      const buildStats = async (from: Date, to: Date): Promise<BranchStat[]> => {
        const { data } = await supabase
          .from('appointments')
          .select('business_id, price, status, businesses(name)')
          .in('business_id', linkedIds)
          .gte('start_time', from.toISOString())
          .lte('start_time', to.toISOString());

        if (!data) return [];

        const map: Record<string, BranchStat> = {};
        data.forEach((a: any) => {
          if (!map[a.business_id]) {
            map[a.business_id] = { business_id: a.business_id, business_name: a.businesses?.name || 'N/A', revenue: 0, appointments: 0, avg_ticket: 0, cancellations: 0 };
          }
          if (a.status === 'COMPLETED') { map[a.business_id].revenue += Number(a.price || 0); map[a.business_id].appointments++; }
          if (['CANCELLED', 'CANCELLED_CLIENT', 'CANCELED'].includes(a.status)) map[a.business_id].cancellations++;
        });

        Object.values(map).forEach(s => {
          s.avg_ticket = s.appointments > 0 ? s.revenue / s.appointments : 0;
        });
        return Object.values(map);
      };

      const [curr, prev] = await Promise.all([buildStats(f1, t1), buildStats(f2, t2)]);
      setStats(curr.sort((a, b) => b[metric] - a[metric]));
      setPrevStats(prev);
    } catch (err) {
      console.error('Error fetching comparator:', err);
    } finally {
      setLoading(false);
    }
  }, [linkedIds, period, metric]);

  useEffect(() => { fetchComparator(); }, [fetchComparator]);

  const getMetricVal = (row: BranchStat) => row[metric];
  const getPrevVal = (id: string) => prevStats.find(p => p.business_id === id)?.[metric] || 0;
  const maxVal = Math.max(...stats.map(s => getMetricVal(s)), 1);

  const chartData = stats.map(s => {
    const prev = getPrevVal(s.business_id);
    return { name: s.business_name, current: getMetricVal(s), previous: prev };
  });

  const MEDALS = ['🥇', '🥈', '🥉'];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:justify-between">
        <h1 className="text-lg font-black text-white">{t.comparator.title}</h1>
        <div className="flex flex-wrap gap-1 sm:gap-2 w-full sm:w-auto">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-all
                ${period === p.key ? 'bg-hubBlue text-white shadow-lg shadow-hubBlue/20' : 'bg-hubSurface border border-hubBorder text-hubText2 hover:text-white'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric selector */}
      <div className="flex gap-1 sm:gap-2 flex-wrap">
        {METRICS.map(m => (
          <button key={m.key} onClick={() => setMetric(m.key)}
            className={`px-2 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all border
              ${metric === m.key ? 'bg-hubBlueMuted border-hubBlue/40 text-hubBlueText' : 'bg-hubSurface border-hubBorder text-hubText2 hover:text-white'}`}>
            <span className="hidden sm:inline">{m.label}</span>
            <span className="sm:hidden">{m.label.slice(0, 3)}</span>
          </button>
        ))}
      </div>

      {/* Bar Chart */}
      <AppointmentsChart data={chartData} metricLabel={METRICS.find(m => m.key === metric)?.label || ''} loading={loading} />

      {/* Ranking */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-hubBorder/40">
          <p className="text-xs sm:text-sm font-black text-white">Ranking por {METRICS.find(m => m.key === metric)?.label}</p>
        </div>
        {loading ? (
          <div className="p-3 sm:p-5 space-y-3 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-hubSurface2 rounded-xl" />)}
          </div>
        ) : (
          <div className="divide-y divide-hubBorder/20">
            {stats.map((row, i) => {
              const curr = getMetricVal(row);
              const prev = getPrevVal(row.business_id);
              const delta = prev > 0 ? ((curr - prev) / prev) * 100 : null;
              const width = ((curr / maxVal) * 100).toFixed(1);
              const isBigDrop = delta !== null && delta < -10;

              return (
                <div key={row.business_id} className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3 sm:px-5 py-3 sm:py-4 hover:bg-hubSurface2/30 transition-colors ${isBigDrop ? 'border-l-2 border-hubDanger' : ''}`}>
                  <span className="text-lg shrink-0 w-8 text-center">{MEDALS[i] || `${i + 1}.`}</span>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0 sm:mb-1.5">
                      <p className="text-xs sm:text-sm font-bold text-white truncate">{row.business_name}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs sm:text-sm font-black text-white">
                          {metric === 'revenue' || metric === 'avg_ticket' ? `€${curr.toFixed(0)}` : curr}
                        </p>
                        {delta !== null && (
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full
                            ${delta >= 0 ? 'bg-hubSuccess/10 text-hubSuccess' : 'bg-hubDanger/10 text-hubDanger'}`}>
                            {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 bg-hubSurface2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isBigDrop ? 'bg-hubDanger' : 'bg-hubBlue'}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
