import React from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  delta?: number | null; // percentage change vs previous period
  icon: string;
  prefix?: string;
  loading?: boolean;
}

export default function MetricCard({ label, value, delta, icon, prefix = '', loading }: MetricCardProps) {
  const isPositive = delta !== null && delta !== undefined && delta >= 0;
  const isNeutral = delta === null || delta === undefined;

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 flex flex-col gap-3 shadow-soft hover:shadow-md transition-all group">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-accent group-hover:bg-blue-50 transition-colors">
          <span className="material-symbols-outlined notranslate text-[20px]" translate="no">{icon}</span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-8 w-2/3 bg-slate-100 rounded-lg" />
          <div className="h-3 w-1/2 bg-slate-100 rounded-lg" />
        </div>
      ) : (
        <>
          <p className="text-2xl font-black text-slate-900 tracking-tight">
            {prefix}{value}
          </p>
          {!isNeutral && (
            <div className={`flex items-center gap-1 text-[11px] font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
              <span className="material-symbols-outlined notranslate text-[14px]" translate="no">
                {isPositive ? 'arrow_upward' : 'arrow_downward'}
              </span>
              {isPositive ? '+' : ''}{delta?.toFixed(1)}%
            </div>
          )}
        </>
      )}
    </div>
  );
}
