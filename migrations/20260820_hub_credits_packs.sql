-- ============================================================
-- TRIMM Hub — Créditos, packs y licencia Enterprise
-- Migration: 20260820_hub_credits_packs.sql
--
-- Modelo de ingresos en dos capas:
--   1. Licencia Enterprise  → cuota fija + bolsa mensual de envíos
--   2. Packs de recarga     → saldo prepago que se acumula
--
-- Los envíos incluidos en el plan caducan a fin de mes (crean el hábito
-- de campaña mensual); los comprados duran 12 meses y cualquier recarga
-- renueva todo el saldo comprado.
--
-- Contabilidad por lotes FIFO: cada bolsa de créditos conoce su origen y
-- su caducidad, de modo que "cuánto saldo tengo" siempre es exacto.
-- ============================================================

-- ============================================================
-- 1. CATÁLOGO DE PACKS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hub_credit_packs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  credits     INT  NOT NULL CHECK (credits > 0),
  price_cents INT  NOT NULL CHECK (price_cents > 0),
  currency    TEXT NOT NULL DEFAULT 'eur',
  badge       TEXT,
  sort_order  INT  NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Escalera de precios: el pack pequeño va por encima de 0,01 €/envío y el
-- grande por debajo, de forma que el descuento por volumen es real y el
-- precio medio ponderado se mantiene sobre el céntimo.
INSERT INTO public.hub_credit_packs (code, name, description, credits, price_cents, badge, sort_order)
VALUES
  ('recarga', 'Recarga',  'Para una campaña puntual en una sucursal.',        1000,  1500, NULL,          1),
  ('salon',   'Salón',    'El ritmo habitual de un salón con base propia.',   5000,  5900, 'Más elegido', 2),
  ('grupo',   'Grupo',    'Varias sucursales con campaña mensual.',          15000, 14900, NULL,          3),
  ('cadena',  'Cadena',   'Volumen alto y campañas segmentadas.',            50000, 39900, 'Mejor precio',4)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. LICENCIA ENTERPRISE DEL HUB
-- La capa de ingreso predecible: sin esto, facturas sólo cuando al
-- cliente le apetece hacer campaña.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hub_subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_owner_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier                   TEXT NOT NULL DEFAULT 'enterprise',
  status                 TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('trialing','active','past_due','cancelled')),
  monthly_credits        INT  NOT NULL DEFAULT 1000,
  stripe_subscription_id TEXT,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hub_owner_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_subscriptions_status
  ON public.hub_subscriptions(status) WHERE status IN ('trialing','active');

-- ============================================================
-- 3. LOTES DE CRÉDITO
-- Cada compra o asignación es un lote con su propia caducidad. Consumir
-- descuenta del lote que caduca antes, para que nadie pierda saldo por
-- el orden en que se gastó.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hub_credit_lots (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_owner_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source                   TEXT NOT NULL CHECK (source IN ('purchase','plan','bonus','refund','adjustment')),
  credits_total            INT  NOT NULL CHECK (credits_total > 0),
  credits_remaining        INT  NOT NULL CHECK (credits_remaining >= 0),
  expires_at               TIMESTAMPTZ NOT NULL,
  pack_id                  UUID REFERENCES public.hub_credit_packs(id) ON DELETE SET NULL,
  price_paid_cents         INT,
  stripe_payment_intent_id TEXT,
  period_key               TEXT,   -- 'YYYY-MM' en los lotes del plan: evita duplicar la bolsa mensual
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_lots_owner_active
  ON public.hub_credit_lots(hub_owner_id, expires_at)
  WHERE credits_remaining > 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_lots_plan_period
  ON public.hub_credit_lots(hub_owner_id, period_key)
  WHERE source = 'plan';

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_lots_payment_intent
  ON public.hub_credit_lots(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- ============================================================
-- 4. LIBRO MAYOR
-- Todo movimiento deja rastro. Es lo que permite responder "¿por qué
-- tengo este saldo?" sin adivinar.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hub_credit_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_owner_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lot_id        UUID REFERENCES public.hub_credit_lots(id) ON DELETE SET NULL,
  delta_credits INT  NOT NULL,   -- + alta de saldo, − consumo
  reason        TEXT NOT NULL,   -- purchase | plan_grant | campaign | refund | expiry | adjustment
  campaign_id   UUID REFERENCES public.hub_campaigns(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_ledger_owner
  ON public.hub_credit_ledger(hub_owner_id, created_at DESC);

-- ============================================================
-- 5. SALDO
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_credit_balance(p_hub_owner_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := COALESCE(p_hub_owner_id, auth.uid());
  v_total INT;
BEGIN
  IF v_owner IS NULL THEN
    RETURN 0;
  END IF;

  -- Un usuario sólo puede consultar su propio saldo. El worker usa
  -- service_role, que no pasa por auth.uid().
  IF auth.uid() IS NOT NULL AND v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  SELECT COALESCE(SUM(credits_remaining), 0) INTO v_total
  FROM hub_credit_lots
  WHERE hub_owner_id = v_owner
    AND credits_remaining > 0
    AND expires_at > now();

  RETURN v_total;
END;
$$;

-- Desglose para la pantalla de saldo: cuánto es del plan (caduca este mes)
-- y cuánto comprado (caduca a 12 meses).
CREATE OR REPLACE FUNCTION public.hub_credit_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_plan INT; v_purchased INT; v_plan_expiry TIMESTAMPTZ; v_purchase_expiry TIMESTAMPTZ;
  v_sub  hub_subscriptions%ROWTYPE;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Sesión requerida';
  END IF;

  SELECT
    COALESCE(SUM(credits_remaining) FILTER (WHERE source = 'plan'), 0),
    COALESCE(SUM(credits_remaining) FILTER (WHERE source <> 'plan'), 0),
    MIN(expires_at) FILTER (WHERE source = 'plan'  AND credits_remaining > 0),
    MAX(expires_at) FILTER (WHERE source <> 'plan' AND credits_remaining > 0)
  INTO v_plan, v_purchased, v_plan_expiry, v_purchase_expiry
  FROM hub_credit_lots
  WHERE hub_owner_id = v_owner
    AND credits_remaining > 0
    AND expires_at > now();

  SELECT * INTO v_sub FROM hub_subscriptions WHERE hub_owner_id = v_owner;

  RETURN jsonb_build_object(
    'total',               v_plan + v_purchased,
    'plan_credits',        v_plan,
    'purchased_credits',   v_purchased,
    'plan_expires_at',     v_plan_expiry,
    'purchase_expires_at', v_purchase_expiry,
    'subscription_tier',   v_sub.tier,
    'subscription_status', v_sub.status,
    'monthly_credits',     COALESCE(v_sub.monthly_credits, 0)
  );
END;
$$;

-- ============================================================
-- 6. CONSUMO — FIFO por caducidad más próxima
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_consume_credits(
  p_hub_owner_id UUID,
  p_credits      INT,
  p_campaign_id  UUID DEFAULT NULL,
  p_reason       TEXT DEFAULT 'campaign'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot       RECORD;
  v_pending   INT := p_credits;
  v_take      INT;
  v_available INT;
BEGIN
  IF p_credits <= 0 THEN
    RETURN jsonb_build_object('success', true, 'consumed', 0);
  END IF;

  -- Bloqueo de los lotes del propietario: dos campañas lanzadas a la vez
  -- no pueden gastar el mismo saldo.
  --
  -- El bloqueo va en una sentencia aparte porque PostgreSQL no admite
  -- FOR UPDATE junto a funciones de agregado.
  PERFORM 1
  FROM hub_credit_lots
  WHERE hub_owner_id = p_hub_owner_id
    AND credits_remaining > 0
    AND expires_at > now()
  FOR UPDATE;

  SELECT COALESCE(SUM(credits_remaining), 0) INTO v_available
  FROM hub_credit_lots
  WHERE hub_owner_id = p_hub_owner_id
    AND credits_remaining > 0
    AND expires_at > now();

  IF v_available < p_credits THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Saldo insuficiente',
      'available', v_available,
      'required', p_credits
    );
  END IF;

  FOR v_lot IN
    SELECT id, credits_remaining
    FROM hub_credit_lots
    WHERE hub_owner_id = p_hub_owner_id
      AND credits_remaining > 0
      AND expires_at > now()
    ORDER BY expires_at ASC, created_at ASC
  LOOP
    EXIT WHEN v_pending <= 0;

    v_take := LEAST(v_lot.credits_remaining, v_pending);

    UPDATE hub_credit_lots
    SET credits_remaining = credits_remaining - v_take
    WHERE id = v_lot.id;

    INSERT INTO hub_credit_ledger (hub_owner_id, lot_id, delta_credits, reason, campaign_id)
    VALUES (p_hub_owner_id, v_lot.id, -v_take, p_reason, p_campaign_id);

    v_pending := v_pending - v_take;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'consumed', p_credits);
END;
$$;

-- ============================================================
-- 7. DEVOLUCIÓN
-- Si se reservaron más envíos de los que salieron, el resto vuelve al
-- saldo. Es lo que sustituye al reembolso por Stripe: nadie paga por
-- correos que no se enviaron.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_refund_credits(
  p_hub_owner_id UUID,
  p_credits      INT,
  p_campaign_id  UUID DEFAULT NULL,
  p_note         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot_id  UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_credits <= 0 THEN
    RETURN jsonb_build_object('success', true, 'refunded', 0);
  END IF;

  -- Se devuelve con la caducidad más lejana que tenga el propietario, para
  -- no perjudicarle por un fallo que no es suyo.
  SELECT MAX(expires_at) INTO v_expires
  FROM hub_credit_lots
  WHERE hub_owner_id = p_hub_owner_id AND expires_at > now();

  INSERT INTO hub_credit_lots (
    hub_owner_id, source, credits_total, credits_remaining, expires_at
  ) VALUES (
    p_hub_owner_id, 'refund', p_credits, p_credits,
    COALESCE(v_expires, now() + INTERVAL '12 months')
  )
  RETURNING id INTO v_lot_id;

  INSERT INTO hub_credit_ledger (hub_owner_id, lot_id, delta_credits, reason, campaign_id, note)
  VALUES (p_hub_owner_id, v_lot_id, p_credits, 'refund', p_campaign_id, p_note);

  RETURN jsonb_build_object('success', true, 'refunded', p_credits);
END;
$$;

-- ============================================================
-- 8. ALTA DE SALDO POR COMPRA
-- Cualquier recarga renueva la caducidad de todo el saldo comprado: el
-- cliente que sigue comprando nunca pierde nada.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_credit_purchase(
  p_hub_owner_id  UUID,
  p_pack_code     TEXT,
  p_payment_intent TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pack   hub_credit_packs%ROWTYPE;
  v_lot_id UUID;
  v_expiry TIMESTAMPTZ := now() + INTERVAL '12 months';
BEGIN
  SELECT * INTO v_pack FROM hub_credit_packs WHERE code = p_pack_code AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pack no disponible');
  END IF;

  -- Idempotencia: si Stripe reintenta el webhook, no se duplica el saldo.
  IF EXISTS (SELECT 1 FROM hub_credit_lots WHERE stripe_payment_intent_id = p_payment_intent) THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true);
  END IF;

  INSERT INTO hub_credit_lots (
    hub_owner_id, source, credits_total, credits_remaining, expires_at,
    pack_id, price_paid_cents, stripe_payment_intent_id
  ) VALUES (
    p_hub_owner_id, 'purchase', v_pack.credits, v_pack.credits, v_expiry,
    v_pack.id, v_pack.price_cents, p_payment_intent
  )
  RETURNING id INTO v_lot_id;

  INSERT INTO hub_credit_ledger (hub_owner_id, lot_id, delta_credits, reason, note)
  VALUES (p_hub_owner_id, v_lot_id, v_pack.credits, 'purchase', v_pack.name);

  -- Renovación del resto del saldo comprado.
  UPDATE hub_credit_lots
  SET expires_at = v_expiry
  WHERE hub_owner_id = p_hub_owner_id
    AND source IN ('purchase','bonus','refund')
    AND credits_remaining > 0
    AND expires_at > now()
    AND expires_at < v_expiry;

  RETURN jsonb_build_object(
    'success', true,
    'credits', v_pack.credits,
    'balance', hub_credit_balance(p_hub_owner_id)
  );
END;
$$;

-- ============================================================
-- 9. BOLSA MENSUAL DEL PLAN
-- Se asigna a principio de mes y caduca al terminarlo: no se acumula, y
-- eso es justo lo que empuja a hacer campaña todos los meses.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_grant_monthly_credits()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub        RECORD;
  v_period     TEXT := to_char(now(), 'YYYY-MM');
  v_month_end  TIMESTAMPTZ := date_trunc('month', now()) + INTERVAL '1 month';
  v_lot_id     UUID;
  v_granted    INT := 0;
BEGIN
  FOR v_sub IN
    SELECT hub_owner_id, monthly_credits
    FROM hub_subscriptions
    WHERE status IN ('trialing','active')
      AND monthly_credits > 0
  LOOP
    BEGIN
      INSERT INTO hub_credit_lots (
        hub_owner_id, source, credits_total, credits_remaining, expires_at, period_key
      ) VALUES (
        v_sub.hub_owner_id, 'plan', v_sub.monthly_credits, v_sub.monthly_credits,
        v_month_end, v_period
      )
      RETURNING id INTO v_lot_id;

      INSERT INTO hub_credit_ledger (hub_owner_id, lot_id, delta_credits, reason, note)
      VALUES (v_sub.hub_owner_id, v_lot_id, v_sub.monthly_credits, 'plan_grant', v_period);

      v_granted := v_granted + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Ya tenía la bolsa de este mes. Seguimos con el siguiente.
      NULL;
    END;
  END LOOP;

  RETURN v_granted;
END;
$$;

-- ============================================================
-- 10. RLS
-- ============================================================

ALTER TABLE public.hub_credit_packs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_credit_lots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_credit_ledger  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_subscriptions  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hub_packs_readable' AND tablename = 'hub_credit_packs') THEN
    -- El catálogo es público para usuarios con sesión: es la tienda.
    CREATE POLICY "hub_packs_readable" ON public.hub_credit_packs
      FOR SELECT TO authenticated USING (active = true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hub_lots_owner' AND tablename = 'hub_credit_lots') THEN
    CREATE POLICY "hub_lots_owner" ON public.hub_credit_lots
      FOR SELECT USING (hub_owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hub_ledger_owner' AND tablename = 'hub_credit_ledger') THEN
    CREATE POLICY "hub_ledger_owner" ON public.hub_credit_ledger
      FOR SELECT USING (hub_owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hub_subscriptions_owner' AND tablename = 'hub_subscriptions') THEN
    CREATE POLICY "hub_subscriptions_owner" ON public.hub_subscriptions
      FOR SELECT USING (hub_owner_id = auth.uid());
  END IF;
END
$$;

-- ============================================================
-- 11. PERMISOS
-- El alta y el consumo de saldo sólo los ejecuta el backend con
-- service_role. El navegador únicamente consulta.
-- ============================================================

REVOKE ALL ON FUNCTION public.hub_consume_credits(UUID, INT, UUID, TEXT)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_refund_credits(UUID, INT, UUID, TEXT)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_credit_purchase(UUID, TEXT, TEXT)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_grant_monthly_credits()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_credit_balance(UUID)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hub_credit_summary()                        FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hub_credit_balance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_credit_summary()     TO authenticated;

-- ============================================================
-- 12. PROGRAMACIÓN
-- pg_cron ya está instalado en este proyecto.
--   · La bolsa mensual se asigna el día 1 a las 03:00 UTC.
--   · El worker de envío se despierta cada minuto y drena lo que haya.
--
-- El worker necesita la URL del proyecto y la service_role key. Se leen de
-- la configuración de la base para no dejarlas escritas en el repositorio:
--
--   ALTER DATABASE postgres SET app.settings.supabase_url         = 'https://<ref>.supabase.co';
--   ALTER DATABASE postgres SET app.settings.service_role_key     = '<service_role_key>';
--
-- Ejecuta esas dos sentencias una sola vez antes de activar el cron.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    PERFORM cron.unschedule('hub-grant-monthly-credits')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hub-grant-monthly-credits');

    PERFORM cron.schedule(
      'hub-grant-monthly-credits',
      '0 3 1 * *',
      $cron$ SELECT public.hub_grant_monthly_credits(); $cron$
    );

  END IF;
END
$$;

COMMENT ON TABLE public.hub_credit_lots IS
  'Lotes de crédito con caducidad. Consumo FIFO por caducidad más próxima: '
  'la bolsa del plan (fin de mes) se gasta antes que el saldo comprado (12 meses).';
