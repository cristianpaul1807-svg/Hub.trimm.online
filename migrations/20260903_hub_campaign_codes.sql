-- ============================================================
-- TRIMM Hub — Códigos de campaña
--
-- ── El agujero que cierra ───────────────────────────────────────────
--
-- Hoy el correo dice «15% de descuento para ti» y no hay absolutamente
-- nada que lo aplique. Ni Trimm ni el Hub saben que esa persona tiene un
-- descuento: la peluquería tiene que acordarse a mano, y el cliente puede
-- presentarse con una captura reclamando algo que ningún sistema registró.
-- Estamos mandando una promesa comercial que nadie cumple.
--
-- El código la convierte en algo real: existe en base de datos, se puede
-- validar, tiene tope, caduca, y al canjearse deja constancia de cuánto
-- dinero se descontó.
--
-- ── Por qué código y no solo enlace ─────────────────────────────────
--
-- El enlace ya existe y ya atribuye (?tc=<token> + hub_attribute_appointment).
-- Pero solo funciona si la persona pincha y reserva en esa misma sesión.
-- Se pierde si abre el correo en el móvil y reserva en el portátil, si
-- llama por teléfono, o si reserva tres días después. Y sobre todo: un
-- enlace no puede tocar el precio.
--
-- El código sobrevive a todo eso. Se dice por teléfono, se apunta en un
-- papel, se teclea una semana más tarde — y es lo único que puede llegar
-- hasta el cobro. Los dos caminos conviven: el enlace lo trae escrito para
-- quien pincha, y el código queda para todos los demás.
--
-- ── Uno por campaña, no uno por persona ─────────────────────────────
--
-- Un código por destinatario daría atribución perfecta, pero es un código
-- que no se puede decir en voz alta ni compartir, y son cuatrocientos
-- códigos para una campaña de cuatrocientos. Uno por campaña se lee por
-- teléfono, y la atribución fina ya la da el enlace cuando se usa.
-- ============================================================

-- ── 1. Los códigos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_campaign_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID REFERENCES public.hub_campaigns(id) ON DELETE CASCADE,
  hub_owner_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Siempre en mayúsculas y sin espacios. Quien lo teclea en el móvil
  -- escribe como quiere; la comparación tiene que ser una sola forma.
  code          TEXT NOT NULL UNIQUE CHECK (code = upper(btrim(code)) AND length(code) >= 6),

  -- 'percent' descuenta un porcentaje, 'fixed' una cantidad en céntimos,
  -- 'none' no toca el precio y solo sirve para saber quién vino de aquí
  -- (fidelización, servicio nuevo, huecos de la semana).
  kind          TEXT NOT NULL DEFAULT 'percent'
                CHECK (kind IN ('percent', 'fixed', 'none')),
  value         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (value >= 0),

  -- Dónde vale. Un grupo con cinco sucursales no quiere que el descuento
  -- de una se canjee en otra.
  business_ids  UUID[] NOT NULL,

  valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until   TIMESTAMPTZ,

  -- Tope de canjes. NULL es sin tope, pero por defecto se pone el número
  -- de correos enviados: un código de campaña filtrado a un grupo de
  -- WhatsApp no debería costar más que la campaña.
  max_redemptions INT CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemptions   INT NOT NULL DEFAULT 0,

  -- Que el mismo cliente no lo use en cada cita del año.
  once_per_client BOOLEAN NOT NULL DEFAULT true,

  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_codes_campana
  ON public.hub_campaign_codes(campaign_id);
CREATE INDEX IF NOT EXISTS idx_hub_codes_duenyo
  ON public.hub_campaign_codes(hub_owner_id, created_at DESC);

-- Un porcentaje por encima de 100 sería pagar por atender.
ALTER TABLE public.hub_campaign_codes
  DROP CONSTRAINT IF EXISTS hub_codes_porcentaje_sensato;
ALTER TABLE public.hub_campaign_codes
  ADD CONSTRAINT hub_codes_porcentaje_sensato
  CHECK (kind <> 'percent' OR value <= 100);

ALTER TABLE public.hub_campaign_codes ENABLE ROW LEVEL SECURITY;

-- El dueño ve los suyos, para poder enseñarlos en la pantalla de la
-- campaña. Escribirlos, solo el servidor.
DROP POLICY IF EXISTS hub_codes_leer ON public.hub_campaign_codes;
CREATE POLICY hub_codes_leer ON public.hub_campaign_codes
  FOR SELECT TO authenticated
  USING (hub_owner_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.hub_campaign_codes FROM authenticated, anon;
GRANT SELECT ON public.hub_campaign_codes TO authenticated;

-- ── 2. Los canjes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_code_redemptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id        UUID NOT NULL REFERENCES public.hub_campaign_codes(id) ON DELETE CASCADE,
  appointment_id UUID,
  client_id      UUID,
  business_id    UUID NOT NULL,
  -- Lo que de verdad se descontó. Sin esto el retorno de la campaña se
  -- calcula sobre la facturación bruta y sale inflado: un 20% de descuento
  -- en 1.000 € de citas no son 1.000 € de beneficio.
  discount_cents INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- La misma cita no se descuenta dos veces por reintento del cliente.
  UNIQUE (code_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_canjes_cliente
  ON public.hub_code_redemptions(code_id, client_id);

ALTER TABLE public.hub_code_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hub_canjes_leer ON public.hub_code_redemptions;
CREATE POLICY hub_canjes_leer ON public.hub_code_redemptions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM hub_campaign_codes c
    WHERE c.id = code_id AND c.hub_owner_id = auth.uid()
  ));

REVOKE INSERT, UPDATE, DELETE ON public.hub_code_redemptions FROM authenticated, anon;
GRANT SELECT ON public.hub_code_redemptions TO authenticated;

-- ── 3. Generar un código legible ────────────────────────────────────
-- Sin I, O, 0 ni 1: la gente los dicta por teléfono y los teclea en un
-- móvil. Confundir una O con un cero es la forma más tonta de perder una
-- reserva.
CREATE OR REPLACE FUNCTION public.hub_new_code(p_prefix TEXT DEFAULT 'TRIMM')
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_alfabeto TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_cola TEXT;
  v_code TEXT;
  i INT;
  intento INT := 0;
BEGIN
  LOOP
    v_cola := '';
    FOR i IN 1..5 LOOP
      v_cola := v_cola || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    END LOOP;

    v_code := upper(regexp_replace(COALESCE(NULLIF(btrim(p_prefix), ''), 'TRIMM'),
                                   '[^A-Za-z0-9]', '', 'g'));
    v_code := left(v_code, 8) || '-' || v_cola;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM hub_campaign_codes WHERE code = v_code);

    -- 32^5 son 33 millones de combinaciones por prefijo; si aquí se llega
    -- veinte veces es que algo va muy mal, y es mejor fallar que girar.
    intento := intento + 1;
    IF intento > 20 THEN
      RAISE EXCEPTION 'No se pudo generar un código único';
    END IF;
  END LOOP;

  RETURN v_code;
END;
$$;

-- ── 4. Crear el código de una campaña ───────────────────────────────
-- La llama el worker al lanzar la campaña, con la clave de servicio.
CREATE OR REPLACE FUNCTION public.hub_create_campaign_code(
  p_campaign_id UUID,
  p_max_redemptions INT DEFAULT NULL,
  p_days_valid INT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_prefijo TEXT;
  v_kind TEXT;
  v_value NUMERIC;
  v_code TEXT;
  v_id UUID;
BEGIN
  SELECT id, hub_owner_id, template_type, discount_value, target_business_ids
    INTO c
  FROM hub_campaigns WHERE id = p_campaign_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Campaña no encontrada');
  END IF;

  -- Una campaña, un código. Si ya lo tiene se devuelve el mismo: esta
  -- función la puede llamar dos veces un reintento del worker.
  SELECT id, code INTO v_id, v_code
  FROM hub_campaign_codes WHERE campaign_id = p_campaign_id LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'code', v_code, 'id', v_id, 'existing', true);
  END IF;

  -- Solo las de descuento tocan el precio. Las demás llevan código
  -- igualmente, porque sirve para saber quién vino de la campaña aunque no
  -- descuente nada.
  IF c.template_type = 'discount' AND COALESCE(c.discount_value, 0) > 0 THEN
    v_kind := 'percent';
    v_value := c.discount_value;
    v_prefijo := 'DTO' || round(c.discount_value)::text;
  ELSE
    v_kind := 'none';
    v_value := 0;
    v_prefijo := CASE c.template_type
                   WHEN 'reengagement' THEN 'VUELVE'
                   WHEN 'loyalty'      THEN 'PUNTOS'
                   ELSE 'TRIMM'
                 END;
  END IF;

  INSERT INTO hub_campaign_codes (
    campaign_id, hub_owner_id, code, kind, value, business_ids,
    valid_until, max_redemptions
  ) VALUES (
    p_campaign_id, c.hub_owner_id, hub_new_code(v_prefijo), v_kind, v_value,
    COALESCE(c.target_business_ids, ARRAY[]::UUID[]),
    now() + make_interval(days => GREATEST(COALESCE(p_days_valid, 60), 1)),
    p_max_redemptions
  )
  RETURNING id, code INTO v_id, v_code;

  RETURN jsonb_build_object('success', true, 'code', v_code, 'id', v_id,
                            'kind', v_kind, 'value', v_value);
END;
$$;

-- ── 5. Validar, sin canjear ─────────────────────────────────────────
-- La llama Trimm en el paso 5 de la reserva, mientras se teclea. La puede
-- llamar alguien sin sesión: el flujo público de reserva no la tiene.
--
-- Devuelve lo justo para pintar el descuento y nada más. No dice a qué
-- campaña pertenece, ni de quién es, ni cuántos canjes lleva: eso es
-- información del negocio y quien reserva no tiene por qué verla.
CREATE OR REPLACE FUNCTION public.hub_validate_code(
  p_code        TEXT,
  p_business_id UUID,
  p_client_id   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_norm TEXT := upper(btrim(COALESCE(p_code, '')));
BEGIN
  IF v_norm = '' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'empty');
  END IF;

  SELECT * INTO c FROM hub_campaign_codes WHERE code = v_norm;

  -- Un código que no existe y uno que no vale aquí dan la misma respuesta
  -- a propósito: si se distinguieran, se podrían enumerar códigos ajenos
  -- probando contra un negocio cualquiera.
  IF NOT FOUND
     OR NOT c.active
     OR NOT (p_business_id = ANY (c.business_ids))
  THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  IF now() < c.valid_from THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_yet');
  END IF;

  IF c.valid_until IS NOT NULL AND now() > c.valid_until THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;

  IF c.max_redemptions IS NOT NULL AND c.redemptions >= c.max_redemptions THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'exhausted');
  END IF;

  IF c.once_per_client AND p_client_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM hub_code_redemptions
       WHERE code_id = c.id AND client_id = p_client_id)
  THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'already_used');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code',  c.code,
    'kind',  c.kind,      -- 'percent' | 'fixed' | 'none'
    'value', c.value,     -- % si percent, céntimos si fixed
    'valid_until', c.valid_until
  );
END;
$$;

-- ── 6. Canjear ──────────────────────────────────────────────────────
-- La llama Trimm cuando la reserva ya está confirmada, no antes: canjear
-- al teclear gastaría el código de quien se arrepiente a mitad.
--
-- Hace las dos cosas de una vez: apunta el canje y atribuye la cita a la
-- campaña. Así el retorno de la campaña incluye también a quien tecleó el
-- código sin haber pinchado nunca el enlace.
CREATE OR REPLACE FUNCTION public.hub_redeem_code(
  p_code           TEXT,
  p_business_id    UUID,
  p_appointment_id UUID,
  p_client_id      UUID DEFAULT NULL,
  p_discount_cents INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_norm TEXT := upper(btrim(COALESCE(p_code, '')));
  v_check JSONB;
BEGIN
  IF p_appointment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_appointment');
  END IF;

  SELECT * INTO c FROM hub_campaign_codes WHERE code = v_norm;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;

  -- Antes que nada: ¿esta misma cita ya lo canjeó? Entonces esto es un
  -- reintento, no un segundo uso.
  --
  -- El orden importa mucho. Si se validara primero, un reintento chocaría
  -- con la regla de «un canje por cliente» y volvería como already_used —
  -- y Trimm, que solo ve un fallo, le diría al cliente que su código no
  -- vale en una reserva que sí lo tiene aplicado. Una llamada perdida por
  -- la red se convertiría en un descuento retirado.
  IF EXISTS (SELECT 1 FROM hub_code_redemptions
              WHERE code_id = c.id AND appointment_id = p_appointment_id) THEN
    RETURN jsonb_build_object(
      'success', true, 'duplicate', true,
      'kind', c.kind, 'value', c.value);
  END IF;

  -- Se bloquea la fila: dos reservas simultáneas con el último canje
  -- disponible leerían las dos que queda uno.
  PERFORM 1 FROM hub_campaign_codes WHERE id = c.id FOR UPDATE;

  -- Se revalida dentro del bloqueo. Validar fuera y canjear dentro es
  -- exactamente el hueco por el que se cuela el canje de más.
  v_check := hub_validate_code(v_norm, p_business_id, p_client_id);
  IF NOT (v_check->>'valid')::boolean THEN
    RETURN jsonb_build_object('success', false, 'reason', v_check->>'reason');
  END IF;

  INSERT INTO hub_code_redemptions (
    code_id, appointment_id, client_id, business_id, discount_cents
  ) VALUES (
    c.id, p_appointment_id, p_client_id, p_business_id, GREATEST(COALESCE(p_discount_cents, 0), 0)
  )
  ON CONFLICT (code_id, appointment_id) DO NOTHING;

  IF NOT FOUND THEN
    -- Segunda red: dos reintentos a la vez pasan los dos la comprobación
    -- de arriba antes de que ninguno haya insertado. El índice único es
    -- quien decide de verdad, y aquí solo se interpreta su veredicto.
    RETURN jsonb_build_object('success', true, 'duplicate', true);
  END IF;

  UPDATE hub_campaign_codes SET redemptions = redemptions + 1 WHERE id = c.id;

  -- Atribuir la cita a la campaña. La primera se lleva el mérito, igual
  -- que en hub_attribute_appointment.
  IF c.campaign_id IS NOT NULL THEN
    UPDATE appointments
       SET hub_campaign_id = c.campaign_id
     WHERE id = p_appointment_id
       AND hub_campaign_id IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'kind', c.kind,
    'value', c.value,
    'discount_cents', GREATEST(COALESCE(p_discount_cents, 0), 0)
  );
END;
$$;

-- ── 7. Permisos ─────────────────────────────────────────────────────
-- Validar y canjear los llama el flujo público de reserva de Trimm, que
-- no tiene sesión. Por eso van a anon — y por eso devuelven lo mínimo.
REVOKE ALL ON FUNCTION public.hub_validate_code(TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_validate_code(TEXT, UUID, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.hub_redeem_code(TEXT, UUID, UUID, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_redeem_code(TEXT, UUID, UUID, UUID, INT) TO anon, authenticated;

-- Crear códigos, solo el servidor.
REVOKE ALL ON FUNCTION public.hub_create_campaign_code(UUID, INT, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_new_code(TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.hub_validate_code(TEXT, UUID, UUID) IS
  'Trimm, paso 5 de la reserva: ¿vale este código aquí y qué descuenta?';
COMMENT ON FUNCTION public.hub_redeem_code(TEXT, UUID, UUID, UUID, INT) IS
  'Trimm, tras confirmar la reserva: apunta el canje y atribuye la cita.';
