import { Link } from 'react-router-dom';
import { formatCredits, formatMoney } from '../../lib/credits';

interface Props {
  audience: number;      // destinatarios elegibles reales
  balance: number;       // envíos disponibles
  reach: number;         // envíos elegidos
  onReachChange: (v: number) => void;
  loading?: boolean;
}

/**
 * Sustituye al antiguo selector de presupuesto en euros. Ahora la unidad es
 * el envío, no el euro: el usuario ve exactamente a cuánta gente va a llegar
 * y cuánto saldo le queda después, sin conversiones mentales.
 */
export default function ReachSelector({
  audience, balance, reach, onReachChange, loading,
}: Props) {
  const max = Math.min(audience, balance);
  const insufficient = balance < audience;
  const noBalance = balance === 0;
  const remaining = Math.max(0, balance - reach);

  return (
    <div className="bg-hubSurface border border-hubBorder rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-black text-hubText">Alcance de la campaña</p>
        <span className="text-[11px] font-bold text-hubText2 bg-hubSurface2 border border-hubBorder px-2.5 py-1 rounded-full tabular-nums">
          {formatCredits(balance)} disponibles
        </span>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-10 bg-hubSurface2 rounded-xl" />
          <div className="h-2 bg-hubSurface2 rounded-full" />
        </div>
      ) : noBalance ? (
        <div className="bg-hubWarning/10 border border-hubWarning/25 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-black text-hubWarning">Te has quedado sin envíos</p>
          <p className="text-[11px] text-hubText2 leading-relaxed">
            Recarga saldo para poder lanzar esta campaña. Tienes{' '}
            {formatCredits(audience)} clientes esperando.
          </p>
          <Link
            to="/dashboard/marketing/credits"
            className="inline-flex items-center gap-1.5 text-xs font-black text-hubBlue hover:underline"
          >
            Ver packs de recarga
            <span className="material-symbols-outlined notranslate text-[14px]" translate="no">arrow_forward</span>
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-hubText tabular-nums tracking-tight">
                {formatCredits(reach)}
              </span>
              <span className="text-sm font-bold text-hubText3">
                de {formatCredits(audience)} clientes
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={max}
              step={Math.max(1, Math.floor(max / 100))}
              value={reach}
              onChange={(e) => onReachChange(Number(e.target.value))}
              aria-label="Número de envíos"
              className="w-full h-1.5 rounded-full bg-hubSurface2 appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-hubBlue [&::-webkit-slider-thumb]:cursor-pointer"
              style={{ accentColor: '#2563eb' }}
            />

            <div className="flex justify-between text-[10px] font-bold text-hubText3 tabular-nums">
              <span>0</span>
              <button
                type="button"
                onClick={() => onReachChange(max)}
                className="text-hubBlue hover:underline font-black"
              >
                Máximo ({formatCredits(max)})
              </button>
            </div>
          </div>

          {insufficient && (
            <div className="bg-hubWarning/10 border border-hubWarning/25 rounded-xl px-3.5 py-2.5">
              <p className="text-[11px] text-hubText2 leading-relaxed">
                Tu saldo cubre {formatCredits(balance)} de los{' '}
                {formatCredits(audience)} clientes elegibles.{' '}
                <Link to="/dashboard/marketing/credits" className="text-hubBlue font-black hover:underline">
                  Recargar
                </Link>{' '}
                para llegar a todos.
              </p>
            </div>
          )}

          <div className="border-t border-hubBorder/60 pt-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-hubText3 font-bold">Envíos que se consumen</span>
              <span className="text-hubText font-black tabular-nums">{formatCredits(reach)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-hubText3 font-bold">Saldo restante</span>
              <span className="text-hubText font-black tabular-nums">{formatCredits(remaining)}</span>
            </div>
            <div className="flex justify-between text-xs pt-2 border-t border-hubBorder/60">
              <span className="text-hubText3 font-bold">Valor equivalente</span>
              <span className="text-hubText2 font-bold tabular-nums">{formatMoney(reach * 0.01)}</span>
            </div>
          </div>

          <p className="text-[10px] text-hubText3 leading-relaxed">
            Solo se descuentan los envíos que salgan de verdad. Si alguno falla,
            vuelve a tu saldo automáticamente.
          </p>
        </>
      )}
    </div>
  );
}
