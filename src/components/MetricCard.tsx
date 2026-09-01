
interface MetricCardProps {
  label: string;
  value: string;
  delta?: number | null;
  icon: string;
  prefix?: string;
  loading?: boolean;
  /** Texto que acompaña al porcentaje. Antes estaba fijo en inglés. */
  deltaLabel?: string;
  /** Para métricas donde subir es malo, como la tasa de cancelación:
   *  sin esto un aumento de cancelaciones se pintaba en verde. */
  invertDelta?: boolean;
}

export default function MetricCard({
  label, value, delta, icon, prefix = '', loading, deltaLabel, invertDelta = false,
}: MetricCardProps) {
  const isNeutral = delta === null || delta === undefined;
  const isUp = !isNeutral && delta >= 0;
  // Sube o baja es un hecho; que sea bueno o malo depende de la métrica.
  const isGood = invertDelta ? !isUp : isUp;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col gap-4 hover:border-slate-300 hover:shadow-md transition-all duration-200 group">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-accent group-hover:bg-blue-50 transition-colors flex-shrink-0">
          <span className="material-symbols-outlined notranslate text-[20px]" translate="no">{icon}</span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-8 w-24 bg-slate-100 rounded-lg" />
          <div className="h-3 w-16 bg-slate-100 rounded-lg" />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-3xl font-black text-slate-900 tracking-tight">
              {prefix}{value}
            </p>
            {!isNeutral && (
              <div className={`flex items-center gap-1 text-xs font-bold ${isGood ? 'text-emerald-600' : 'text-red-600'}`}>
                <span className="material-symbols-outlined notranslate text-[14px]" translate="no">
                  {isUp ? 'trending_up' : 'trending_down'}
                </span>
                {isUp ? '+' : ''}{delta?.toFixed(1)}% {deltaLabel ?? ''}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
