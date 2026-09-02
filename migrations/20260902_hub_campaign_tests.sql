-- ============================================================
-- TRIMM Hub — El cupo de pruebas, también para las campañas
--
-- El cupo se ató a hub_email_templates.id porque nació en la pantalla de
-- Plantillas. Pero la prueba hace más falta en el asistente de campaña:
-- ahí es donde alguien está a punto de pagar por mandar un correo que no
-- ha visto nunca. Y ahí no hay plantilla guardada — hay un tipo de campaña
-- (descuento, recuperación, fidelización) y un porcentaje.
--
-- Así que la columna deja de ser un identificador de plantilla y pasa a ser
-- una clave de texto: 'plantilla:<uuid>' o 'campana:discount'. Es lo mismo
-- que contaba antes, dicho de una forma que sirve para las dos pantallas.
--
-- Las funciones antiguas se quedan como envoltorio sobre las nuevas: la
-- versión desplegada de hub-template-preview sigue llamándolas con un UUID
-- y no se puede quedar rota entre un despliegue y el siguiente.
-- ============================================================

ALTER TABLE public.hub_template_tests
  ADD COLUMN IF NOT EXISTS test_key TEXT;

-- Lo ya contado hoy sigue contando: si se perdiera, el cupo se reiniciaría
-- con la migración y las pruebas de hoy saldrían gratis.
UPDATE public.hub_template_tests
   SET test_key = 'plantilla:' || template_id::text
 WHERE test_key IS NULL;

ALTER TABLE public.hub_template_tests
  ALTER COLUMN test_key SET NOT NULL;

-- Ya no hay siempre una plantilla detrás.
ALTER TABLE public.hub_template_tests
  ALTER COLUMN template_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hub_template_tests_clave
  ON public.hub_template_tests(hub_owner_id, test_key, sent_at DESC);

COMMENT ON COLUMN public.hub_template_tests.test_key IS
  'Contra qué se cuenta la prueba: plantilla:<uuid> o campana:<tipo>.';

-- ── Consultar el cupo ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hub_test_quota_key(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_clave INT;
  v_dia INT;
BEGIN
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error', 'Sin sesión');
  END IF;

  SELECT count(*) INTO v_clave
  FROM hub_template_tests
  WHERE hub_owner_id = v_owner
    AND test_key = p_key
    AND sent_at >= date_trunc('day', now());

  SELECT count(*) INTO v_dia
  FROM hub_template_tests
  WHERE hub_owner_id = v_owner
    AND sent_at >= date_trunc('day', now());

  RETURN jsonb_build_object(
    'per_template_limit', 2,
    'per_template_used',  v_clave,
    'remaining',          GREATEST(2 - v_clave, 0),
    'daily_limit',        10,
    'daily_used',         v_dia
  );
END;
$$;

-- ── Consumir una prueba ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hub_consume_test_key(
  p_hub_owner_id UUID,
  p_key          TEXT,
  p_sent_to      TEXT,
  p_template_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clave INT;
  v_dia INT;
  v_test_id UUID;
BEGIN
  -- Se bloquea la cuenta mientras se cuenta y se inserta, para que dos
  -- pulsaciones simultáneas no lean las dos el mismo "queda una".
  PERFORM pg_advisory_xact_lock(hashtext('hub_test_' || p_hub_owner_id::text));

  SELECT count(*) INTO v_clave
  FROM hub_template_tests
  WHERE hub_owner_id = p_hub_owner_id
    AND test_key = p_key
    AND sent_at >= date_trunc('day', now());

  IF v_clave >= 2 THEN
    RETURN jsonb_build_object(
      'allowed', false, 'reason', 'per_template',
      'used', v_clave, 'remaining', 0);
  END IF;

  SELECT count(*) INTO v_dia
  FROM hub_template_tests
  WHERE hub_owner_id = p_hub_owner_id
    AND sent_at >= date_trunc('day', now());

  IF v_dia >= 10 THEN
    RETURN jsonb_build_object(
      'allowed', false, 'reason', 'daily',
      'used', v_clave, 'remaining', 0, 'daily_used', v_dia);
  END IF;

  INSERT INTO hub_template_tests (hub_owner_id, template_id, test_key, sent_to)
  VALUES (p_hub_owner_id, p_template_id, p_key, p_sent_to)
  RETURNING id INTO v_test_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'test_id', v_test_id,
    'used', v_clave + 1,
    'remaining', 2 - (v_clave + 1),
    'daily_used', v_dia + 1);
END;
$$;

-- ── Las de antes, ahora envoltorios ─────────────────────────────────
-- Siguen existiendo con la misma firma para que la versión desplegada de
-- hub-template-preview no se caiga mientras se despliega la nueva.
CREATE OR REPLACE FUNCTION public.hub_test_quota(p_template_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT hub_test_quota_key('plantilla:' || p_template_id::text) $$;

CREATE OR REPLACE FUNCTION public.hub_consume_test(
  p_hub_owner_id UUID,
  p_template_id  UUID,
  p_sent_to      TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hub_consume_test_key(
    p_hub_owner_id, 'plantilla:' || p_template_id::text, p_sent_to, p_template_id)
$$;

REVOKE ALL ON FUNCTION public.hub_test_quota_key(TEXT)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hub_test_quota_key(TEXT)   TO authenticated;

-- Consumir cupo solo desde la función de envío, con la clave de servicio.
REVOKE ALL ON FUNCTION public.hub_consume_test_key(UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
