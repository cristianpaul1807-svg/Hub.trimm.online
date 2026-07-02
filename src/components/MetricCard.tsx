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
    <div className="bg-hubSurface border border-hubBorder rounded-2xl p-5 flex flex-col gap-3 hover:border-hubBorder/80 transition-colors group">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-black uppercase tracking-widest text-hubText3">{label}</p>
        <div className="w-8 h-8 rounded-xl bg-hubSurface2 flex items-center justify-center text-hubBlueText group-hover:bg-hubBlueMuted transition-colors">
          <span className="material-symbols-outlined notranslate text-[18px]" translate="no">{icon}</span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-7 w-2/3 bg-hubSurface2 rounded-lg" />
          <div className="h-3 w-1/2 bg-hubSurface2 rounded-lg" />
        </div>
      ) : (
        <>
          <p className="text-2xl font-black text-white tracking-tight">
            {prefix}{value}
          </p>
          {!isNeutral && (
            <div className={`flex items-center gap-1 text-[11px] font-bold ${isPositive ? 'text-hubSuccess' : 'text-hubDanger'}`}>
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
