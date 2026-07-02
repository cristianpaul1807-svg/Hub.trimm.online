import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

interface RevenueChartProps {
  data: Array<{ date: string; total: number; [key: string]: any }>;
  branches?: string[];
  loading?: boolean;
}

const BRANCH_COLORS = ['#2563eb', '#60a5fa', '#93c5fd', '#3b82f6', '#1d4ed8'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xl text-xs">
      <p className="font-black text-slate-400 mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-600 font-bold">{p.name}:</span>
          <span className="text-slate-900 font-black">€{Number(p.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
};

export default function RevenueChart({ data, branches = [], loading }: RevenueChartProps) {
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-6 animate-pulse shadow-soft">
        <div className="h-4 w-1/3 bg-slate-100 rounded mb-4" />
        <div className="h-48 bg-slate-100 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-soft">
      <p className="text-sm font-black text-slate-900 mb-4">Ingresos por período</p>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
          <Tooltip content={<CustomTooltip />} />
          {branches.length > 0 && <Legend wrapperStyle={{ fontSize: 10, color: '#64748b', fontWeight: 700 }} />}
          <Area type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={2} fill="url(#colorTotal)" name="Total" />
          {branches.map((b, i) => (
            <Area key={b} type="monotone" dataKey={b} stroke={BRANCH_COLORS[i + 1] || '#3b82f6'} strokeWidth={1.5} fill="none" name={b} strokeDasharray="4 2" />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
