import React, { useState, useEffect, useCallback } from 'react';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';
import { supabase } from '../lib/supabase';
import StaffPerformanceChart from '../components/charts/StaffPerformanceChart';

type Period = 'today' | 'week' | 'month' | 'year';
type SortKey = 'total_revenue' | 'total_appointments' | 'avg_ticket';

interface StaffRow {
  staff_id: string;
  staff_name: string;
  business_id: string;
  business_name: string;
  total_revenue: number;
  total_appointments: number;
  avg_ticket: number;
}

function getPeriodRange(period: Period): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  let from = new Date(now);
  if (period === 'today') { from.setHours(0, 0, 0, 0); }
  else if (period === 'week') { from.setDate(now.getDate() - 7); }
  else if (period === 'month') { from.setDate(1); from.setHours(0, 0, 0, 0); }
  else { from.setFullYear(now.getFullYear(), 0, 1); from.setHours(0, 0, 0, 0); }
  return { from, to };
}

interface WorkersProps { selectedBusinessId: string | null; }

export default function Workers({ selectedBusinessId }: WorkersProps) {
  const { user } = useHubAuth();
  const { t } = useHubLang();
  const [period, setPeriod] = useState<Period>('week');
  const [sortKey, setSortKey] = useState<SortKey>('total_revenue');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [staffData, setStaffData] = useState<StaffRow[]>([]);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'today', label: t.periods.today },
    { key: 'week', label: t.periods.week },
    { key: 'month', label: t.periods.month },
    { key: 'year', label: t.periods.year },
  ];

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from('hub_connections')
        .select('business_id, businesses(name)')
        .eq('hub_owner_id', user.id);
      if (data) {
        setLinkedIds(data.map((d: any) => d.business_id));
        setBranches(data);
      }
    };
    fetch();
  }, [user]);

  const fetchStaff = useCallback(async () => {
    if (!linkedIds.length) { setLoading(false); return; }
    setLoading(true);
    try {
      const { from, to } = getPeriodRange(period);
      const ids = selectedBusinessId ? [selectedBusinessId] :
        filterBranch !== 'all' ? [filterBranch] : linkedIds;

      const { data, error } = await supabase.rpc('get_hub_staff_metrics', {
        p_business_ids: ids,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });
      if (!error && data) setStaffData(data as StaffRow[]);
    } catch (err) {
      console.error('Error fetching staff metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [linkedIds, period, filterBranch, selectedBusinessId]);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  const sorted = [...staffData].sort((a, b) => b[sortKey] - a[sortKey]);
  const chartData = sorted.map(s => ({ name: s.staff_name, revenue: Number(s.total_revenue), appointments: Number(s.total_appointments) }));

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      onClick={() => setSortKey(field)}
      className={`text-left py-3 px-4 text-[10px] font-black uppercase tracking-wider cursor-pointer hover:text-white transition-colors select-none
        ${sortKey === field ? 'text-hubBlueText' : 'text-hubText3'}`}
    >
      {label} {sortKey === field && '↓'}
    </th>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h1 className="text-lg font-black text-white">{t.workers.title}</h1>

        <div className="flex flex-wrap gap-2">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-all
                ${period === p.key ? 'bg-hubBlue text-white shadow-lg shadow-hubBlue/20' : 'bg-hubSurface border border-hubBorder text-hubText2 hover:text-white'}`}
            >
              {p.label}
            </button>
          ))}

          {!selectedBusinessId && (
            <select
              value={filterBranch}
              onChange={e => setFilterBranch(e.target.value)}
              className="bg-hubSurface border border-hubBorder rounded-full px-3 py-1.5 text-xs font-bold text-hubText2 focus:outline-none focus:border-hubBlue/40"
            >
              <option value="all">{t.workers.allBranches}</option>
              {branches.map((b: any) => (
                <option key={b.business_id} value={b.business_id}>{b.businesses?.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <StaffPerformanceChart data={chartData} loading={loading} />

      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-hubSurface2/50 border-b border-hubBorder/40">
            <tr>
              <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-wider text-hubText3">{t.workers.staffName}</th>
              {!selectedBusinessId && <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-wider text-hubText3">{t.workers.branch}</th>}
              <SortHeader label={t.workers.appointments} field="total_appointments" />
              <SortHeader label={t.workers.revenue} field="total_revenue" />
              <SortHeader label={t.workers.avgTicket} field="avg_ticket" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-hubBorder/20 animate-pulse">
                  <td className="py-3 px-4"><div className="h-4 w-32 bg-hubSurface2 rounded" /></td>
                  {!selectedBusinessId && <td className="py-3 px-4"><div className="h-4 w-24 bg-hubSurface2 rounded" /></td>}
                  <td className="py-3 px-4"><div className="h-4 w-12 bg-hubSurface2 rounded" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-16 bg-hubSurface2 rounded" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-14 bg-hubSurface2 rounded" /></td>
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={selectedBusinessId ? 4 : 5} className="py-12 text-center text-sm text-hubText3 font-bold">
                  {t.errors.noData}
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr key={row.staff_id} className="border-b border-hubBorder/20 hover:bg-hubSurface2/30 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-hubBlueMuted flex items-center justify-center text-xs font-black text-hubBlueText shrink-0">
                        {(row.staff_name || '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{row.staff_name}</p>
                        {i === 0 && <p className="text-[9px] text-hubSuccess font-black">🥇 TOP</p>}
                      </div>
                    </div>
                  </td>
                  {!selectedBusinessId && (
                    <td className="py-3 px-4 text-xs text-hubText2 font-bold">{row.business_name}</td>
                  )}
                  <td className="py-3 px-4 text-sm font-black text-white">{row.total_appointments}</td>
                  <td className="py-3 px-4 text-sm font-black text-white">€{Number(row.total_revenue).toFixed(0)}</td>
                  <td className="py-3 px-4 text-sm font-black text-white">€{Number(row.avg_ticket).toFixed(0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
