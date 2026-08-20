import React, { useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { supabase } from '../../lib/supabase';
import { getStripe, stripeAppearance, stripeConfigured } from '../../lib/stripe';
import {
  CreditPack, formatCredits, formatEuros, formatPricePerEmail, savingsPercent,
} from '../../lib/credits';

// ── Formulario de confirmación (3D Secure o tarjeta nueva) ───────────
function ConfirmForm({
  pack, paymentIntentId, onDone, onCancel,
}: {
  pack: CreditPack;
  paymentIntentId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setBusy(true);
    setError('');

    const { error: confirmErr } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (confirmErr) {
      setError(confirmErr.message ?? 'No se pudo completar el pago.');
      setBusy(false);
      return;
    }

    // El pago está confirmado en Stripe; el saldo lo acredita el servidor
    // tras verificarlo, nunca el navegador.
    const { data, error: fnErr } = await supabase.functions.invoke('hub-buy-credits', {
      body: { pack_code: pack.code, payment_intent_id: paymentIntentId },
    });

    if (fnErr || !data?.success) {
      setError(data?.error ?? 'El pago se realizó pero no pudimos acreditar el saldo. Contacta con soporte.');
      setBusy(false);
      return;
    }

    onDone();
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
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 hover:text-hubText py-3 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={busy || !stripe}
          className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center"
        >
          {busy
            ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : `Pagar ${formatEuros(pack.price_cents)}`}
        </button>
      </div>
    </form>
  );
}

// ── Tienda ───────────────────────────────────────────────────────────
interface Props {
  packs: CreditPack[];
  loading?: boolean;
  onPurchased: () => void;
}

export default function PackStore({ packs, loading, onPurchased }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState<{
    pack: CreditPack; clientSecret: string; paymentIntentId: string;
  } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const buy = async (pack: CreditPack) => {
    setPending(pack.code);
    setError('');
    setSuccess(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('hub-buy-credits', {
        body: { pack_code: pack.code },
      });

      if (fnErr && !data) throw new Error('No se pudo contactar con el servicio de pago.');

      if (data?.success) {
        setSuccess(`Se han añadido ${formatCredits(pack.credits)} envíos a tu saldo.`);
        onPurchased();
        return;
      }

      if (data?.requires_action && data?.client_secret) {
        if (!stripeConfigured) {
          throw new Error('Falta configurar la clave pública de Stripe en el Hub.');
        }
        setCheckout({
          pack,
          clientSecret: data.client_secret,
          paymentIntentId: data.payment_intent_id,
        });
        return;
      }

      throw new Error(data?.error ?? 'No se pudo iniciar el pago.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-hubSurface border border-hubBorder rounded-3xl p-6 h-56 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {success && (
        <div className="bg-hubSuccess/10 border border-hubSuccess/25 text-hubSuccess rounded-2xl px-4 py-3 text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined notranslate text-[18px]" translate="no">check_circle</span>
          {success}
        </div>
      )}

      {error && (
        <div className="bg-hubDanger/10 border border-hubDanger/25 text-hubDanger rounded-2xl px-4 py-3 text-xs font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {packs.map((pack) => {
          const savings = savingsPercent(pack, packs);
          const highlighted = Boolean(pack.badge);

          return (
            <div
              key={pack.id}
              className={`relative bg-hubSurface rounded-3xl p-6 flex flex-col gap-4 transition-all
                ${highlighted
                  ? 'border-2 border-hubBlue shadow-[0_10px_40px_-14px_rgba(37,99,235,0.35)]'
                  : 'border border-hubBorder hover:border-hubBlue/40'}`}
            >
              {pack.badge && (
                <span className="absolute -top-2.5 left-6 bg-hubBlue text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full">
                  {pack.badge}
                </span>
              )}

              <div>
                <p className="text-sm font-black text-hubText">{pack.name}</p>
                <p className="text-[11px] text-hubText3 font-bold mt-0.5 leading-snug min-h-[2.2em]">
                  {pack.description}
                </p>
              </div>

              <div>
                <p className="text-3xl font-black text-hubText tracking-tight tabular-nums">
                  {formatCredits(pack.credits)}
                </p>
                <p className="text-[11px] font-black uppercase tracking-wider text-hubText3">
                  envíos
                </p>
              </div>

              <div className="border-t border-hubBorder/60 pt-4 mt-auto space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-black text-hubText tabular-nums">
                    {formatEuros(pack.price_cents)}
                  </span>
                  {savings > 0 && (
                    <span className="text-[10px] font-black text-hubSuccess bg-hubSuccess/10 px-2 py-0.5 rounded-full">
                      −{savings}%
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-hubText3 font-bold tabular-nums">
                  {formatPricePerEmail(pack)} por envío
                </p>
              </div>

              <button
                onClick={() => buy(pack)}
                disabled={pending !== null}
                className={`w-full py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center
                  ${highlighted
                    ? 'bg-hubBlue hover:bg-hubBlueHover text-white'
                    : 'bg-hubSurface2 hover:bg-hubBorder border border-hubBorder text-hubText'}`}
              >
                {pending === pack.code
                  ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : 'Recargar'}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-hubText3 leading-relaxed">
        Los envíos comprados no caducan durante 12 meses, y cada nueva recarga
        renueva la validez de todo tu saldo. Si una campaña envía menos de lo
        previsto, los envíos sobrantes vuelven automáticamente a tu saldo.
      </p>

      {/* Confirmación de pago */}
      {checkout && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setCheckout(null)}
        >
          <div
            className="bg-hubSurface border border-hubBorder rounded-3xl p-6 w-full max-w-md space-y-5 my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-black text-hubText">
                Pack {checkout.pack.name}
              </h3>
              <p className="text-xs text-hubText2 font-bold mt-1">
                {formatCredits(checkout.pack.credits)} envíos ·{' '}
                {formatEuros(checkout.pack.price_cents)}
              </p>
            </div>

            <Elements
              stripe={getStripe()}
              options={{ clientSecret: checkout.clientSecret, appearance: stripeAppearance }}
            >
              <ConfirmForm
                pack={checkout.pack}
                paymentIntentId={checkout.paymentIntentId}
                onCancel={() => setCheckout(null)}
                onDone={() => {
                  setCheckout(null);
                  setSuccess(`Se han añadido ${formatCredits(checkout.pack.credits)} envíos a tu saldo.`);
                  onPurchased();
                }}
              />
            </Elements>
          </div>
        </div>
      )}
    </div>
  );
}
