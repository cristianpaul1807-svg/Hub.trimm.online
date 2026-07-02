import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface StaffPerformanceChartProps {
  data: Array<{ name: string; revenue: number; appointments: number }>;
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
          <span className="text-white font-black">{p.name === 'Facturado' ? `€${p.value}` : p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function StaffPerformanceChart({ data, loading }: StaffPerformanceChartProps) {
  if (loading) {
    return (
      <div className="bg-hubSurface border border-hubBorder rounded-2xl p-6 animate-pulse">
        <div className="h-4 w-1/3 bg-hubSurface2 rounded mb-4" />
        <div className="h-48 bg-hubSurface2 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="bg-hubSurface border border-hubBorder rounded-2xl p-6">
      <p className="text-sm font-black text-white mb-4">Top Trabajadores — Facturado</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#555555', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false}
            tickFormatter={(v) => `€${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
          <YAxis type="category" dataKey="name" tick={{ fill: '#a0a0a0', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} width={80} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="revenue" name="Facturado" fill="#2563eb" radius={[0, 6, 6, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
