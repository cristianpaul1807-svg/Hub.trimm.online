import React, { useState, useEffect, useCallback } from 'react';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';
import { supabase } from '../lib/supabase';
import MetricCard from '../components/MetricCard';
import RevenueChart from '../components/charts/RevenueChart';

type Period = 'today' | 'week' | 'month' | 'year';

interface DashboardProps {
  selectedBusinessId: string | null;
}

interface HubMetrics {
  total_revenue: number;
  total_appointments: number;
  cancelled_appointments: number;
  new_clients: number;
  avg_ticket: number;
  active_loyalty_cards: number;
  discounts_applied: number;
}

function getPeriodRange(period: Period): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  let from = new Date(now);

  if (period === 'today') {
    from.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    from.setDate(now.getDate() - 7);
  } else if (period === 'month') {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  } else {
    from.setFullYear(now.getFullYear(), 0, 1);
    from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

function formatCurrency(n: number, currency = '€') {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

export default function Dashboard({ selectedBusinessId }: DashboardProps) {
  const { user } = useHubAuth();
  const { t } = useHubLang();
  const [period, setPeriod] = useState<Period>('week');
  const [metrics, setMetrics] = useState<HubMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [linkedBusinesses, setLinkedBusinesses] = useState<any[]>([]);
  const [revenueData, setRevenueData] = useState<any[]>([]);

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'today', label: t.periods.today },
    { key: 'week', label: t.periods.week },
    { key: 'month', label: t.periods.month },
    { key: 'year', label: t.periods.year },
  ];

  // Fetch linked businesses
  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from('hub_connections')
        .select('business_id, businesses(name)')
        .eq('hub_owner_id', user.id);
      if (data) {
        setLinkedIds(data.map((d: any) => d.business_id));
        setLinkedBusinesses(data);
      }
    };
    fetch();
  }, [user]);

  // Fetch metrics when period / selected business changes
  const fetchMetrics = useCallback(async () => {
    if (!linkedIds.length) { setLoading(false); return; }
    setLoading(true);
    try {
      const { from, to } = getPeriodRange(period);
      const ids = selectedBusinessId ? [selectedBusinessId] : linkedIds;

      const { data, error } = await supabase.rpc('get_hub_metrics', {
        p_business_ids: ids,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });

      if (!error && data) {
        setMetrics(data as HubMetrics);
      }

      // Build simple per-day revenue
      const { data: appts } = await supabase
        .from('appointments')
        .select('start_time, price, business_id')
        .in('business_id', ids)
        .gte('start_time', from.toISOString())
        .lte('start_time', to.toISOString())
        .eq('status', 'COMPLETED');

      if (appts) {
        const map: Record<string, number> = {};
        appts.forEach((a: any) => {
          const day = new Date(a.start_time).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
          map[day] = (map[day] || 0) + (Number(a.price) || 0);
        });
        setRevenueData(Object.entries(map).map(([date, total]) => ({ date, total })));
      }
    } catch (err) {
      console.error('Error fetching hub metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [linkedIds, period, selectedBusinessId]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const kpis = [
    { label: t.metrics.totalRevenue, value: `€${formatCurrency(metrics?.total_revenue || 0)}`, icon: 'payments' },
    { label: t.metrics.avgTicket, value: `€${(metrics?.avg_ticket || 0).toFixed(0)}`, icon: 'receipt_long' },
    { label: t.metrics.appointments, value: String(metrics?.total_appointments || 0), icon: 'calendar_month' },
    { label: t.metrics.cancellations, value: String(metrics?.cancelled_appointments || 0), icon: 'event_busy' },
    { label: t.metrics.newClients, value: String(metrics?.new_clients || 0), icon: 'person_add' },
    { label: t.metrics.loyaltyCards, value: String(metrics?.active_loyalty_cards || 0), icon: 'loyalty' },
    { label: t.metrics.discounts, value: `€${formatCurrency(metrics?.discounts_applied || 0)}`, icon: 'local_offer' },
    { label: t.metrics.occupancy, value: '—', icon: 'schedule' },
  ];

  if (!linkedIds.length && !loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8 text-center">
        <div className="w-20 h-20 bg-white border border-slate-100 rounded-[32px] flex items-center justify-center text-accent shadow-soft">
          <span className="material-symbols-outlined notranslate text-4xl" translate="no">corporate_fare</span>
        </div>
        <div className="space-y-3 max-w-sm">
          <h2 className="text-2xl font-black text-slate-900">{t.errors.noData}</h2>
          <p className="text-sm text-slate-500 font-medium">{t.settings.noBusinessesHelper}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Period Selector */}
      <div className="flex items-center gap-3">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all
              ${period === p.key
                ? 'bg-accent text-white shadow-lg shadow-accent/20'
                : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 shadow-sm'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {kpis.map((kpi, i) => (
          <MetricCard
            key={i}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            loading={loading}
          />
        ))}
      </div>

      {/* Revenue Chart */}
      <RevenueChart data={revenueData} loading={loading} />

      {/* Branch quick summary */}
      {!selectedBusinessId && linkedBusinesses.length > 0 && (
        <div className="bg-white border border-slate-100 rounded-[32px] p-8 shadow-soft">
          <div className="flex items-center justify-between mb-6">
            <p className="text-sm font-black text-slate-900 uppercase tracking-widest">{t.sidebar.metrics}</p>
            <span className="text-[10px] font-black text-accent bg-blue-50 px-3 py-1 rounded-full">{linkedBusinesses.length} {t.settings.linkedBusinesses}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {linkedBusinesses.map((b: any, i: number) => (
              <div key={b.business_id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-50 hover:bg-slate-50 transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-sm font-black text-accent shadow-sm group-hover:scale-105 transition-transform">
                    {(b.businesses?.name || 'N')[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-900">{b.businesses?.name}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{t.settings.linkedBusinesses}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-emerald-600 font-black uppercase">{t.topbar.allBranches}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
