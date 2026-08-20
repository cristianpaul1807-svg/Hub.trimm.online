import { Link } from 'react-router-dom';
import { CreditSummary, formatCredits, formatDate } from '../../lib/credits';

interface Props {
  summary: CreditSummary;
  loading?: boolean;
  compact?: boolean;
}

/**
 * Saldo de envíos. Separa a propósito la bolsa del plan (caduca a fin de
 * mes) del saldo comprado (12 meses), porque son cosas distintas y el
 * cliente necesita ver cuál está a punto de perder.
 */
export default function CreditBalance({ summary, loading, compact }: Props) {
  const { total, plan_credits, purchased_credits, plan_expires_at, purchase_expires_at } = summary;
  const planShare = total > 0 ? (plan_credits / total) * 100 : 0;

  if (loading) {
    return (
      <div className="bg-hubSurface border border-hubBorder rounded-3xl p-6 animate-pulse space-y-4">
        <div className="h-3 w-24 bg-hubSurface2 rounded" />
        <div className="h-10 w-40 bg-hubSurface2 rounded" />
        <div className="h-2 w-full bg-hubSurface2 rounded-full" />
      </div>
    );
  }

  return (
    <div className="bg-hubSurface border border-hubBorder rounded-3xl p-6 space-y-5 shadow-[0_10px_40px_-14px_rgba(15,23,42,0.14)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-hubText3">
            Saldo de envíos
          </p>
          <p className="text-4xl font-black text-hubText tracking-tight mt-1 tabular-nums">
            {formatCredits(total)}
          </p>
        </div>
        {!compact && (
          <Link
            to="/dashboard/marketing/credits"
            className="bg-hubBlue hover:bg-hubBlueHover text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shrink-0"
          >
            <span className="material-symbols-outlined notranslate text-[16px]" translate="no">add</span>
            Recargar
          </Link>
        )}
      </div>

      {total > 0 ? (
        <>
          {/* Proporción plan vs comprado */}
          <div className="h-2 bg-hubSurface2 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-hubBlue transition-all duration-500"
              style={{ width: `${planShare}%` }}
              aria-hidden="true"
            />
            <div
              className="h-full bg-hubSuccess transition-all duration-500"
              style={{ width: `${100 - planShare}%` }}
              aria-hidden="true"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-hubBlue" />
                <p className="text-[10px] font-black uppercase tracking-wider text-hubText3">
                  De tu plan
                </p>
              </div>
              <p className="text-lg font-black text-hubText tabular-nums">
                {formatCredits(plan_credits)}
              </p>
              {plan_expires_at && plan_credits > 0 && (
                <p className="text-[10px] text-hubWarning font-bold">
                  Caduca el {formatDate(plan_expires_at)}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-hubSuccess" />
                <p className="text-[10px] font-black uppercase tracking-wider text-hubText3">
                  Comprados
                </p>
              </div>
              <p className="text-lg font-black text-hubText tabular-nums">
                {formatCredits(purchased_credits)}
              </p>
              {purchase_expires_at && purchased_credits > 0 && (
                <p className="text-[10px] text-hubText3 font-bold">
                  Válidos hasta {formatDate(purchase_expires_at)}
                </p>
              )}
            </div>
          </div>

          {plan_credits > 0 && (
            <p className="text-[11px] text-hubText2 leading-relaxed border-t border-hubBorder/60 pt-4">
              Los envíos de tu plan se gastan primero y no se acumulan de un mes
              a otro. Los comprados se guardan y se renuevan con cada recarga.
            </p>
          )}
        </>
      ) : (
        <div className="border-t border-hubBorder/60 pt-4 space-y-3">
          <p className="text-xs text-hubText2 leading-relaxed">
            No te quedan envíos disponibles. Recarga saldo para poder lanzar
            campañas a tu base de clientes.
          </p>
          {compact && (
            <Link
              to="/dashboard/marketing/credits"
              className="inline-flex items-center gap-1.5 text-xs font-black text-hubBlue hover:underline"
            >
              Ver packs disponibles
              <span className="material-symbols-outlined notranslate text-[14px]" translate="no">arrow_forward</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
