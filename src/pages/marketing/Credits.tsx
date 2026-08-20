import { useCallback, useEffect, useState } from 'react';
import { useHubAuth } from '../../contexts/HubAuthContext';
import CreditBalance from '../../components/marketing/CreditBalance';
import PackStore from '../../components/marketing/PackStore';
import {
  CreditPack, CreditSummary, EMPTY_SUMMARY, LedgerEntry,
  LEDGER_ICONS, LEDGER_LABELS, fetchCreditSummary, fetchLedger, fetchPacks,
  formatCredits,
} from '../../lib/credits';

export default function Credits() {
  const { user } = useHubAuth();
  const [summary, setSummary] = useState<CreditSummary>(EMPTY_SUMMARY);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [s, p, l] = await Promise.all([
        fetchCreditSummary(),
        fetchPacks(),
        fetchLedger(25),
      ]);
      setSummary(s);
      setPacks(p);
      setLedger(l);
      setError('');
    } catch (err: any) {
      setError(err.message ?? 'No se pudo cargar tu saldo.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-black text-hubText">Saldo y recargas</h1>
        <p className="text-xs text-hubText3 font-bold mt-0.5">
          Tus envíos disponibles y los packs para recargar
        </p>
      </div>

      {error && (
        <div className="bg-hubDanger/10 border border-hubDanger/25 text-hubDanger rounded-2xl px-4 py-3 text-xs font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <CreditBalance summary={summary} loading={loading} compact />
        </div>

        {/* Qué incluye el plan */}
        <div className="lg:col-span-2 bg-hubSurface border border-hubBorder rounded-3xl p-6 flex flex-col justify-center gap-3">
          {summary.subscription_status && summary.monthly_credits > 0 ? (
            <>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined notranslate text-hubBlue text-[20px]" translate="no">
                  card_membership
                </span>
                <p className="text-sm font-black text-hubText capitalize">
                  Plan {summary.subscription_tier ?? 'Enterprise'}
                </p>
                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full
                  ${summary.subscription_status === 'active'
                    ? 'bg-hubSuccess/10 text-hubSuccess'
                    : 'bg-hubWarning/10 text-hubWarning'}`}>
                  {summary.subscription_status === 'active' ? 'Activo'
                    : summary.subscription_status === 'trialing' ? 'Prueba'
                    : summary.subscription_status === 'past_due' ? 'Pago pendiente' : 'Cancelado'}
                </span>
              </div>
              <p className="text-sm text-hubText2 leading-relaxed">
                Tu plan incluye <strong className="text-hubText">
                {formatCredits(summary.monthly_credits)} envíos cada mes</strong>. Se
                renuevan el día 1 y no se acumulan, así que lo que no uses este mes
                se pierde. El saldo que compras aparte sí se guarda.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined notranslate text-hubText3 text-[20px]" translate="no">
                  card_membership
                </span>
                <p className="text-sm font-black text-hubText">Sin envíos mensuales incluidos</p>
              </div>
              <p className="text-sm text-hubText2 leading-relaxed">
                Ahora mismo pagas solo por lo que envías. Con el plan Enterprise
                del Hub recibirías una bolsa de envíos cada mes incluida en la cuota.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Packs */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-black text-hubText">Packs de recarga</h2>
          <p className="text-xs text-hubText3 font-bold mt-0.5">
            Cuantos más envíos, menor es el precio por envío
          </p>
        </div>
        <PackStore packs={packs} loading={loading} onPurchased={load} />
      </div>

      {/* Movimientos */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-hubBorder/60">
          <p className="text-sm font-black text-hubText">Movimientos de saldo</p>
        </div>

        {loading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 bg-hubSurface2 rounded-xl" />
            ))}
          </div>
        ) : ledger.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-symbols-outlined notranslate text-4xl text-hubText3" translate="no">
              receipt_long
            </span>
            <p className="text-sm text-hubText3 font-bold mt-3">Todavía no hay movimientos</p>
          </div>
        ) : (
          <div className="divide-y divide-hubBorder/60">
            {ledger.map((entry) => {
              const positive = entry.delta_credits > 0;
              return (
                <div key={entry.id} className="px-5 py-3.5 flex items-center gap-4">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0
                    ${positive ? 'bg-hubSuccess/10 text-hubSuccess' : 'bg-hubSurface2 text-hubText2'}`}>
                    <span className="material-symbols-outlined notranslate text-[18px]" translate="no">
                      {LEDGER_ICONS[entry.reason] ?? 'swap_horiz'}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-hubText truncate">
                      {LEDGER_LABELS[entry.reason] ?? entry.reason}
                      {entry.note && <span className="text-hubText3 font-medium"> · {entry.note}</span>}
                    </p>
                    <p className="text-[10px] text-hubText3 font-bold">
                      {new Date(entry.created_at).toLocaleDateString('es-ES', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>

                  <span className={`text-sm font-black tabular-nums shrink-0
                    ${positive ? 'text-hubSuccess' : 'text-hubText'}`}>
                    {positive ? '+' : '−'}{formatCredits(Math.abs(entry.delta_credits))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
