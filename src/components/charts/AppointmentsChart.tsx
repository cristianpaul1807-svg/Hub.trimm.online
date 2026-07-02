import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell
} from 'recharts';

interface ComparatorChartProps {
  data: Array<{ name: string; current: number; previous: number }>;
  metricLabel: string;
  prefix?: string;
  loading?: boolean;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-hubSurface border border-hubBorder rounded-xl p-3 shadow-xl shadow-black/50 text-xs">
      <p className="font-black text-white mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.fill }} />
          <span className="text-hubText2 font-bold">{p.name}:</span>
          <span className="text-white font-black">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function AppointmentsChart({ data, metricLabel, prefix = '', loading }: ComparatorChartProps) {
  if (loading) {
    return (
      <div className="bg-hubSurface border border-hubBorder rounded-2xl p-6 animate-pulse">
        <div className="h-4 w-1/2 bg-hubSurface2 rounded mb-4" />
        <div className="h-48 bg-hubSurface2 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="bg-hubSurface border border-hubBorder rounded-2xl p-6">
      <p className="text-sm font-black text-white mb-4">{metricLabel} — Período actual vs anterior</p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} barGap={4} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: '#555555', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#555555', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10, color: '#a0a0a0', fontWeight: 700 }} />
          <Bar dataKey="current" name="Período actual" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={40} />
          <Bar dataKey="previous" name="Período anterior" fill="#2a2a2a" radius={[6, 6, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
