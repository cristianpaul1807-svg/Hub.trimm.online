import React, { useCallback, useEffect, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useHubAuth } from '../../contexts/HubAuthContext';
import { supabase } from '../../lib/supabase';
import { getStripe, stripeAppearance, stripeConfigured } from '../../lib/stripe';
import { formatCredits, formatEuros } from '../../lib/credits';

const CARD_BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
};

/**
 * Formulario real de tarjeta. Antes esto era un alert() de demostración que
 * nunca llegaba a guardar nada, de modo que el Hub creía tener método de pago
 * sin tenerlo.
 */
function CardForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setBusy(true);
    setError('');

    const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (confirmErr || !setupIntent?.payment_method) {
      setError(confirmErr?.message ?? 'No se pudo guardar la tarjeta.');
      setBusy(false);
      return;
    }

    // El servidor lee la tarjeta desde Stripe y activa la facturación. El
    // navegador nunca decide por sí solo que hay método de pago válido.
    const { data, error: fnErr } = await supabase.functions.invoke('hub-save-payment-method', {
      body: { payment_method_id: setupIntent.payment_method },
    });

    if (fnErr || data?.error) {
      setError(data?.error ?? 'La tarjeta se validó pero no se pudo guardar.');
      setBusy(false);
      return;
    }

    onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />

      {error && (
        <p className="text-xs text-hubDanger font-bold bg-hubDanger/10 border border-hubDanger/20 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button" onClick={onCancel} disabled={busy}
          className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 hover:text-hubText py-3 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit" disabled={busy || !stripe}
          className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center"
        >
          {busy
            ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : 'Guardar tarjeta'}
        </button>
      </div>
    </form>
  );
}

export default function Billing() {
  const { user } = useHubAuth();
  const [billing, setBilling] = useState<any>(null);
  const [lots, setLots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: bil }, { data: purchases }] = await Promise.all([
      supabase.from('hub_billing').select('*').eq('hub_owner_id', user.id).maybeSingle(),
      supabase.from('hub_credit_lots')
        .select('id, credits_total, price_paid_cents, created_at, source')
        .eq('source', 'purchase')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    setBilling(bil);
    setLots(purchases ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const startCardSetup = async () => {
    setConnecting(true);
    setError('');
    try {
      if (!stripeConfigured) {
        throw new Error('Falta configurar VITE_STRIPE_PUBLISHABLE_KEY en el Hub.');
      }
      const { data, error: fnErr } = await supabase.functions.invoke('hub-create-setup-intent');
      if (fnErr || !data?.client_secret) {
        throw new Error(data?.error ?? 'No se pudo iniciar la conexión de pago.');
      }
      setClientSecret(data.client_secret);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await supabase.functions.invoke('hub-disconnect-billing');
      setShowDisconnect(false);
      await load();
    } catch (err) {
      console.error(err);
    } finally {
      setDisconnecting(false);
    }
  };

  const hasCard = billing?.status === 'active' && billing?.stripe_pm_id;
  const totalSpent = lots.reduce((s, l) => s + (l.price_paid_cents ?? 0), 0);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-lg font-black text-hubText">Facturación</h1>
        <p className="text-xs text-hubText3 font-bold mt-0.5">
          Tu método de pago y el historial de recargas
        </p>
      </div>

      {error && (
        <div className="bg-hubDanger/10 border border-hubDanger/25 text-hubDanger rounded-2xl px-4 py-3 text-xs font-bold">
          {error}
        </div>
      )}

      {/* Método de pago */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-hubBorder/60">
          <p className="text-sm font-black text-hubText">Método de pago</p>
        </div>

        {loading ? (
          <div className="p-5 animate-pulse"><div className="h-14 bg-hubSurface2 rounded-xl" /></div>
        ) : clientSecret ? (
          <div className="p-5">
            <Elements
              stripe={getStripe()}
              options={{ clientSecret, appearance: stripeAppearance }}
            >
              <CardForm
                onCancel={() => setClientSecret(null)}
                onSaved={async () => { setClientSecret(null); await load(); }}
              />
            </Elements>
          </div>
        ) : hasCard ? (
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-10 rounded-xl bg-hubBlue/10 border border-hubBlue/20 flex items-center justify-center text-hubBlue">
                <span className="material-symbols-outlined notranslate text-[20px]" translate="no">credit_card</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-hubText truncate">
                  {CARD_BRANDS[billing.card_brand] ?? 'Tarjeta'} ···· {billing.card_last4}
                </p>
                <p className="text-[10px] text-hubText3 font-bold tabular-nums">
                  Caduca {String(billing.card_exp_month).padStart(2, '0')}/{billing.card_exp_year}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <span className="w-2 h-2 rounded-full bg-hubSuccess" />
                <span className="text-[10px] text-hubSuccess font-black uppercase tracking-wider">Activa</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={startCardSetup} disabled={connecting}
                className="flex-1 bg-hubSurface2 hover:bg-hubBorder border border-hubBorder text-hubText2 hover:text-hubText py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              >
                Cambiar tarjeta
              </button>
              <button
                onClick={() => setShowDisconnect(true)}
                className="flex-1 bg-hubDanger/10 hover:bg-hubDanger/20 border border-hubDanger/25 text-hubDanger py-2.5 rounded-xl text-xs font-bold transition-all"
              >
                Desconectar
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 bg-hubSurface2 border border-hubBorder rounded-2xl flex items-center justify-center text-hubText3 mx-auto">
                <span className="material-symbols-outlined notranslate text-2xl" translate="no">credit_card</span>
              </div>
              <p className="text-sm font-bold text-hubText">Sin tarjeta guardada</p>
              <p className="text-xs text-hubText2 max-w-sm mx-auto leading-relaxed">
                Guarda una tarjeta para recargar saldo con un clic. También puedes
                pagar cada recarga por separado sin guardarla.
              </p>
            </div>
            <button
              onClick={startCardSetup} disabled={connecting}
              className="w-full bg-hubBlue hover:bg-hubBlueHover text-white py-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center disabled:opacity-50"
            >
              {connecting
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : 'Guardar tarjeta'}
            </button>
          </div>
        )}
      </div>

      {/* Resumen */}
      {lots.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-hubSurface border border-hubBorder rounded-2xl p-4 space-y-1">
            <p className="text-[10px] text-hubText3 font-black uppercase tracking-widest">Total recargado</p>
            <p className="text-xl font-black text-hubText tabular-nums">{formatEuros(totalSpent)}</p>
          </div>
          <div className="bg-hubSurface border border-hubBorder rounded-2xl p-4 space-y-1">
            <p className="text-[10px] text-hubText3 font-black uppercase tracking-widest">Envíos comprados</p>
            <p className="text-xl font-black text-hubText tabular-nums">
              {formatCredits(lots.reduce((s, l) => s + (l.credits_total ?? 0), 0))}
            </p>
          </div>
        </div>
      )}

      {/* Historial de recargas */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-hubBorder/60">
          <p className="text-sm font-black text-hubText">Historial de recargas</p>
        </div>

        {loading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-12 bg-hubSurface2 rounded-xl" />
            ))}
          </div>
        ) : lots.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-symbols-outlined notranslate text-4xl text-hubText3" translate="no">receipt_long</span>
            <p className="text-sm text-hubText3 font-bold mt-3">Todavía no has recargado saldo</p>
          </div>
        ) : (
          <div className="divide-y divide-hubBorder/60">
            {lots.map((lot) => (
              <div key={lot.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-hubText">
                    {formatCredits(lot.credits_total)} envíos
                  </p>
                  <p className="text-[10px] text-hubText3 font-bold tabular-nums">
                    {new Date(lot.created_at).toLocaleDateString('es-ES', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </p>
                </div>
                <span className="text-sm font-black text-hubText tabular-nums shrink-0">
                  {formatEuros(lot.price_paid_cents ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmación de desconexión */}
      {showDisconnect && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setShowDisconnect(false)}
        >
          <div
            className="bg-hubSurface border border-hubBorder rounded-3xl p-6 w-full max-w-sm space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-2xl bg-hubDanger/10 border border-hubDanger/20 flex items-center justify-center text-hubDanger mx-auto">
              <span className="material-symbols-outlined notranslate text-2xl" translate="no">credit_card_off</span>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-base font-black text-hubText">¿Quitar la tarjeta guardada?</h3>
              <p className="text-xs text-hubText2 leading-relaxed">
                Tu saldo de envíos actual no se ve afectado y las campañas en
                curso seguirán enviándose. Solo tendrás que introducir la tarjeta
                de nuevo la próxima vez que recargues.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDisconnect(false)}
                className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 hover:text-hubText py-3 rounded-2xl text-xs font-bold transition-all"
              >
                Mantener
              </button>
              <button
                onClick={disconnect} disabled={disconnecting}
                className="flex-1 bg-hubDanger hover:bg-red-700 text-white py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center"
              >
                {disconnecting
                  ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : 'Quitar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
