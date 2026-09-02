import React, { useEffect, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { getStripe, stripeAppearance, stripeConfigured } from '../../lib/stripe';
import {
  CampaignQuote, finishCampaignCheckout, formatCredits, formatEuros,
  quoteCampaign, startCampaignCheckout,
} from '../../lib/credits';

// ── Confirmación de tarjeta (3D Secure o tarjeta nueva) ──────────────
function ConfirmForm({
  amountCents, emails, paymentIntentId, onDone, onCancel,
}: {
  amountCents: number;
  emails: number;
  paymentIntentId: string;
  onDone: (recipients: number, leftover: number) => void;
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

    // El pago está confirmado en Stripe, pero la campaña la lanza el
    // servidor tras verificarlo. El navegador nunca decide cuántos correos
    // salen: eso lo dicen los metadatos del cobro.
    try {
      const res = await finishCampaignCheckout(paymentIntentId);
      onDone(res.recipients ?? emails, res.leftover ?? 0);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
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
            : `Pagar ${formatEuros(amountCents)}`}
        </button>
      </div>
    </form>
  );
}

// ── Panel ────────────────────────────────────────────────────────────
interface Props {
  templateId?: string | null;
  templateType: string;
  targetBusinessIds: string[];
  discountValue?: number;
  audience: number;
  /** Se llama cuando la campaña ya ha salido. */
  onLaunched: (recipients: number, leftover: number) => void;
}

const PRESETS = [500, 1000, 2500, 5000];

/**
 * Pagar una campaña suelta, sin pasar por los packs.
 *
 * La lógica es la de Instagram o TikTok: eliges cuánto te gastas y se
 * calcula el alcance, no al revés. Quien nunca ha hecho email marketing no
 * sabe si mil correos son muchos o pocos, pero sí sabe si quiere gastarse
 * cinco euros o cincuenta.
 *
 * El número de correos lo calcula la base de datos, no esta pantalla, y el
 * servidor lo vuelve a calcular antes de cobrar. Aquí solo se enseña.
 */
export default function DirectPayPanel({
  templateId, templateType, targetBusinessIds, discountValue, audience, onLaunched,
}: Props) {
  const [budget, setBudget] = useState(PRESETS[0]);
  const [quote, setQuote] = useState<CampaignQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState<{
    clientSecret: string; paymentIntentId: string; amountCents: number; emails: number;
  } | null>(null);

  // El presupuesto se toca con un deslizador, así que se espera a que la
  // mano se pare antes de preguntar: si no, cada píxel sería una consulta.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!targetBusinessIds.length) return;

    if (timer.current) clearTimeout(timer.current);
    setQuoting(true);

    timer.current = setTimeout(async () => {
      const q = await quoteCampaign(targetBusinessIds, templateType, budget);
      setQuote(q);
      setQuoting(false);
    }, 300);

    return () => { if (timer.current) clearTimeout(timer.current); };
    // targetBusinessIds es un array nuevo en cada render del padre; se
    // depende de su contenido para no relanzar la consulta sin motivo.
  }, [budget, templateType, targetBusinessIds.join(',')]);

  const pagar = async () => {
    setPaying(true);
    setError('');

    try {
      const res = await startCampaignCheckout({
        templateId,
        templateType,
        targetBusinessIds,
        discountValue,
        budgetCents: budget,
      });

      if (res.success) {
        onLaunched(res.recipients ?? 0, res.leftover ?? 0);
        return;
      }

      if (res.requires_action && res.client_secret && res.payment_intent_id) {
        if (!stripeConfigured) {
          throw new Error('Falta configurar la clave pública de Stripe en el Hub.');
        }
        setCheckout({
          clientSecret: res.client_secret,
          paymentIntentId: res.payment_intent_id,
          amountCents: quote?.amount_cents ?? budget,
          emails: quote?.emails ?? 0,
        });
        return;
      }

      throw new Error('No se pudo iniciar el pago.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  };

  const rate = quote?.rate_cents ?? 2;
  const minimo = quote?.min_budget_cents ?? 500;

  // Lo que cuesta escribir hoy a toda la audiencia. No es el tope del
  // deslizador —gastar de más es legítimo, los envíos sobrantes quedan en
  // el saldo— pero sí el atajo que casi todo el mundo quiere.
  const costeAudiencia = Math.min(
    quote?.max_budget_cents ?? 100000,
    Math.max(minimo, Math.ceil(audience * rate)),
  );

  // Y el tope: nunca por encima de lo que permite la tarifa, y siempre lo
  // bastante alto como para cubrir la audiencia entera.
  const techo = Math.min(
    quote?.max_budget_cents ?? 100000,
    Math.max(costeAudiencia, PRESETS[PRESETS.length - 1]),
  );

  const envios = quote?.emails ?? 0;
  const comprados = quote?.credits ?? envios;
  const sobrante = quote?.leftover ?? 0;
  const importe = quote?.amount_cents ?? 0;
  const puedePagar = !quoting && !paying && envios > 0 && importe >= minimo;

  return (
    <div className="bg-hubSurface border-2 border-hubBlue/40 rounded-2xl p-5 space-y-5 shadow-[0_10px_40px_-18px_rgba(37,99,235,0.4)]">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-hubBlue/10 text-hubBlue flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined notranslate text-[20px]" translate="no">bolt</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black text-hubText">Pagar solo esta campaña</p>
          <p className="text-[11px] text-hubText2 mt-0.5 leading-snug">
            Sin comprar un pack. Dinos cuánto quieres gastar y calculamos
            cuántos correos salen.
          </p>
        </div>
      </div>

      {/* Presupuesto */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {PRESETS.filter((p) => p <= techo).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setBudget(p)}
              className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all tabular-nums
                ${budget === p
                  ? 'bg-hubBlue text-white border-transparent'
                  : 'bg-hubSurface2 border-hubBorder text-hubText2 hover:border-hubBlue/40'}`}
            >
              {formatEuros(p)}
            </button>
          ))}
          {!PRESETS.includes(costeAudiencia) && (
            <button
              type="button"
              onClick={() => setBudget(costeAudiencia)}
              className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all tabular-nums
                ${budget === costeAudiencia
                  ? 'bg-hubBlue text-white border-transparent'
                  : 'bg-hubSurface2 border-hubBorder text-hubText2 hover:border-hubBlue/40'}`}
            >
              Escribir a todos
            </button>
          )}
        </div>

        <input
          type="range"
          min={minimo}
          max={Math.max(techo, minimo)}
          step={50}
          value={Math.min(budget, Math.max(techo, minimo))}
          onChange={(e) => setBudget(Number(e.target.value))}
          aria-label="Presupuesto de la campaña"
          className="w-full h-1.5 rounded-full bg-hubSurface2 appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-hubBlue [&::-webkit-slider-thumb]:cursor-pointer"
          style={{ accentColor: '#2563eb' }}
        />
      </div>

      {/* Lo que se cobra */}
      <div className="bg-hubSurface2 border border-hubBorder rounded-2xl p-4 space-y-3">
        {quoting ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-8 w-32 bg-hubBorder/60 rounded-lg" />
            <div className="h-3 w-44 bg-hubBorder/60 rounded" />
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-hubText tabular-nums tracking-tight">
                {formatCredits(envios)}
              </span>
              <span className="text-sm font-bold text-hubText3">
                correos por {formatEuros(importe)}
              </span>
            </div>

            <div className="flex justify-between text-[11px] pt-1 border-t border-hubBorder/60">
              <span className="text-hubText3 font-bold">Precio por envío</span>
              <span className="text-hubText2 font-black tabular-nums">
                {(rate / 100).toFixed(3).replace('.', ',')} €
              </span>
            </div>

            {/* Se compra más de lo que sale hoy. Decirlo aquí, y no en la
                letra pequeña, es la diferencia entre vender envíos por
                adelantado y cobrar de más. */}
            {sobrante > 0 && (
              <p className="text-[11px] text-hubText2 leading-relaxed bg-hubBlue/5 border border-hubBlue/20 rounded-xl px-3 py-2">
                Compras {formatCredits(comprados)} envíos. Ahora mismo solo
                tienes {formatCredits(audience)} clientes elegibles, así que
                salen {formatCredits(envios)} y los{' '}
                {formatCredits(sobrante)} restantes se quedan en tu saldo
                para la próxima campaña.
              </p>
            )}

            {envios === 0 && (
              <p className="text-[11px] text-hubText2 leading-relaxed">
                No hay destinatarios elegibles para esta campaña ahora mismo.
              </p>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="bg-hubDanger/10 border border-hubDanger/25 text-hubDanger px-4 py-3 rounded-xl text-xs font-bold">
          {error}
        </div>
      )}

      <button
        onClick={pagar}
        disabled={!puedePagar}
        className="w-full bg-hubBlue hover:bg-hubBlueHover text-white py-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
      >
        {paying
          ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          : `Pagar ${formatEuros(importe)} y enviar`}
      </button>

      <p className="text-[10px] text-hubText3 leading-relaxed">
        Se cobra una sola vez, sin suscripción, y los envíos que compres
        valen 12 meses. Si alguno falla, vuelve a tu saldo. Si vas a mandar
        a menudo, los packs salen más baratos por envío.
      </p>

      {/* Confirmación de tarjeta */}
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
              <h3 className="text-base font-black text-hubText">Confirma el pago</h3>
              <p className="text-xs text-hubText2 font-bold mt-1">
                {formatCredits(checkout.emails)} correos ·{' '}
                {formatEuros(checkout.amountCents)}
              </p>
            </div>

            <Elements
              stripe={getStripe()}
              options={{ clientSecret: checkout.clientSecret, appearance: stripeAppearance }}
            >
              <ConfirmForm
                amountCents={checkout.amountCents}
                emails={checkout.emails}
                paymentIntentId={checkout.paymentIntentId}
                onCancel={() => setCheckout(null)}
                onDone={(recipients, leftover) => {
                  setCheckout(null);
                  onLaunched(recipients, leftover);
                }}
              />
            </Elements>
          </div>
        </div>
      )}
    </div>
  );
}
