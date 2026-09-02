-- ============================================================
-- TRIMM Hub — Pagar una campaña suelta
--
-- Hasta ahora, sin saldo no había campaña: o comprabas un pack o no
-- enviabas. Esto añade el otro camino, el de Instagram y TikTok: dices
-- cuánto quieres gastarte, calculamos cuántos correos son a nuestra tarifa,
-- se cobra eso y se envía eso.
--
-- ── Por qué la tarifa directa es más cara que el pack ────────────────
--
-- Los packs van de 0,015 €/envío (Recarga) a 0,008 (Cadena). Si el pago
-- suelto costara lo mismo o menos, nadie compraría un pack nunca: el pack
-- solo tiene sentido si comprar por adelantado sale mejor. 0,02 € deja la
-- escalera intacta y sigue siendo un número redondo para la pantalla:
-- 5 € son 250 envíos, 20 € son 1.000.
--
-- ── Por qué el mínimo son 5 € ───────────────────────────────────────
--
-- Stripe cobra alrededor de 1,5 % + 0,25 € por operación con tarjeta
-- europea. En una campaña de 1 € eso es un 27 % de comisión; en 5 €, un
-- 6,6 %. Por debajo de 5 € el cobro se come la venta.
--
-- ── Qué se cobra exactamente ────────────────────────────────────────
--
-- Lo menor entre el presupuesto y la audiencia real. Si pides 20 € pero
-- solo tienes 300 clientes elegibles, se cobran 6 € y se mandan 300. Cobrar
-- los 20 y mandar 300 sería quedarse con dinero por correos que no existen.
-- ============================================================

-- ── 1. Tarifa, en base de datos ─────────────────────────────────────
-- En una tabla y no en el código: subir la tarifa no debería exigir un
-- despliegue, igual que no lo exige cambiar el precio de un pack.
CREATE TABLE IF NOT EXISTS public.hub_pricing (
  id                 BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),  -- una sola fila
  direct_rate_cents  NUMERIC(6,3) NOT NULL DEFAULT 2.0 CHECK (direct_rate_cents > 0),
  min_budget_cents   INT NOT NULL DEFAULT 500 CHECK (min_budget_cents >= 50),
  max_budget_cents   INT NOT NULL DEFAULT 100000,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.hub_pricing (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN public.hub_pricing.direct_rate_cents IS
  'Céntimos por envío en el pago suelto. Debe ser mayor que el peor pack '
  '(hoy 1,5) o los packs dejan de tener sentido.';
COMMENT ON COLUMN public.hub_pricing.min_budget_cents IS
  'Mínimo por campaña. Por debajo, la comisión de Stripe se come la venta.';

ALTER TABLE public.hub_pricing ENABLE ROW LEVEL SECURITY;

-- La tarifa es pública para quien tiene sesión: hay que poder enseñarla
-- antes de pagar. Cambiarla, solo desde el panel de Supabase.
DROP POLICY IF EXISTS hub_pricing_leer ON public.hub_pricing;
CREATE POLICY hub_pricing_leer ON public.hub_pricing
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.hub_pricing FROM authenticated, anon;
GRANT SELECT ON public.hub_pricing TO authenticated;

-- ── 2. Presupuesto → envíos ─────────────────────────────────────────
-- La usa la pantalla mientras el usuario mueve el importe, y la vuelve a
-- usar el servidor antes de cobrar. Misma función las dos veces: si fueran
-- dos cuentas distintas, el precio mostrado y el cobrado divergirían.
CREATE OR REPLACE FUNCTION public.hub_quote_campaign(
  p_business_ids  UUID[],
  p_template_type TEXT,
  p_days_inactive INT,
  p_budget_cents  INT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner     UUID := auth.uid();
  v_rate      NUMERIC;
  v_min       INT;
  v_max       INT;
  v_audiencia INT;
  v_pagables  INT;
  v_envios    INT;
  v_importe   INT;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Sin sesión';
  END IF;

  SELECT direct_rate_cents, min_budget_cents, max_budget_cents
    INTO v_rate, v_min, v_max
  FROM hub_pricing WHERE id;

  -- hub_resolve_audience comprueba que las sucursales sean suyas y hayan
  -- autorizado el marketing, así que la comprobación de acceso está ahí.
  SELECT count(*) INTO v_audiencia
  FROM hub_resolve_audience(v_owner, p_business_ids,
                            COALESCE(p_template_type, 'discount'),
                            COALESCE(p_days_inactive, 30));

  -- Cuántos envíos paga el presupuesto, hacia abajo: no se manda medio
  -- correo, y redondear hacia arriba sería regalar envíos.
  v_pagables := FLOOR(GREATEST(p_budget_cents, 0) / v_rate);

  -- Y se cobra lo menor de los dos: presupuesto o clientes que existen.
  v_envios := LEAST(v_pagables, v_audiencia);
  v_importe := CEIL(v_envios * v_rate);

  RETURN jsonb_build_object(
    'audience',        v_audiencia,
    'rate_cents',      v_rate,
    'min_budget_cents', v_min,
    'max_budget_cents', v_max,
    'budget_cents',    p_budget_cents,
    'affordable',      v_pagables,
    'emails',          v_envios,
    'amount_cents',    v_importe,
    -- El presupuesto da para más correos de los que hay clientes: se avisa
    -- para que la pantalla lo diga en vez de cobrar de más en silencio.
    'capped_by_audience', v_pagables > v_audiencia,
    'below_minimum',   p_budget_cents < v_min
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hub_quote_campaign(UUID[], TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hub_quote_campaign(UUID[], TEXT, INT, INT) TO authenticated;

-- ── 3. Acreditar un pago suelto ─────────────────────────────────────
-- Hermana de hub_credit_purchase, pero con importe y envíos libres en vez
-- de un pack. Idempotente sobre el PaymentIntent por el mismo motivo: si
-- Stripe reintenta el webhook, el saldo no se duplica.
CREATE OR REPLACE FUNCTION public.hub_credit_direct(
  p_hub_owner_id   UUID,
  p_credits        INT,
  p_payment_intent TEXT,
  p_price_cents    INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot_id UUID;
  v_expiry TIMESTAMPTZ := now() + INTERVAL '12 months';
BEGIN
  IF p_credits <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin envíos que acreditar');
  END IF;

  IF EXISTS (SELECT 1 FROM hub_credit_lots WHERE stripe_payment_intent_id = p_payment_intent) THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true);
  END IF;

  INSERT INTO hub_credit_lots (
    hub_owner_id, source, credits_total, credits_remaining, expires_at,
    price_paid_cents, stripe_payment_intent_id
  ) VALUES (
    p_hub_owner_id, 'purchase', p_credits, p_credits, v_expiry,
    p_price_cents, p_payment_intent
  )
  RETURNING id INTO v_lot_id;

  INSERT INTO hub_credit_ledger (hub_owner_id, lot_id, delta_credits, reason, note)
  VALUES (p_hub_owner_id, v_lot_id, p_credits, 'purchase', 'Campaña pagada suelta');

  RETURN jsonb_build_object(
    'success', true,
    'lot_id', v_lot_id,
    'credits', p_credits,
    'balance', hub_credit_balance(p_hub_owner_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hub_credit_direct(UUID, INT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.hub_credit_direct(UUID, INT, TEXT, INT) IS
  'Acredita los envíos de una campaña pagada suelta. La llama '
  'hub-campaign-checkout tras confirmar el cobro en Stripe.';
