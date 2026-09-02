-- ============================================================
-- TRIMM Hub — Cupo de correos de prueba
--
-- Antes el límite vivía en un Map en memoria de la Edge Function. Eso no
-- es un límite: las funciones arrancan en frío, cada instancia tiene su
-- propio mapa, y basta con caer en otra —o esperar a un reinicio— para
-- saltárselo. Un contador que no persiste no cuenta nada.
--
-- Ahora se guarda en base de datos, con dos topes:
--
--   · 2 por plantilla y día. Es lo pedido: poder verse el correo en el
--     buzón antes de gastar créditos. Se reinicia cada día porque el uso
--     real es probar, ver que algo no encaja, corregir y volver a probar;
--     con dos para toda la vida de la plantilla, la segunda prueba se
--     gasta con miedo.
--
--   · 10 al día por cuenta. Sin este segundo tope, quien cree cien
--     plantillas manda doscientos correos: el cupo por plantilla no acota
--     el total. Y cada prueba sale por marketing.trimm.online, así que el
--     total es exactamente lo que hay que acotar.
--
-- El destinatario nunca se elige aquí: la función de envío lo toma de la
-- sesión. Esta tabla solo cuenta.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hub_template_tests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Sin FK a la plantilla: si se borra, el histórico del día debe seguir
  -- contando. Si no, borrar y recrear sería la forma de reiniciar el cupo.
  template_id  UUID NOT NULL,
  sent_to      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_template_tests_cupo
  ON public.hub_template_tests(hub_owner_id, template_id, sent_at DESC);

ALTER TABLE public.hub_template_tests ENABLE ROW LEVEL SECURITY;

-- Solo lectura desde el navegador, para poder enseñar cuántas quedan. Las
-- filas las escribe la función de envío con la clave de servicio: si el
-- navegador pudiera insertar o borrar, el cupo sería decorativo.
DROP POLICY IF EXISTS hub_template_tests_leer ON public.hub_template_tests;
CREATE POLICY hub_template_tests_leer ON public.hub_template_tests
  FOR SELECT TO authenticated
  USING (hub_owner_id = auth.uid());

-- Dos capas, no una. Sin política de escritura, RLS ya filtra todas las
-- filas; pero eso depende de la AUSENCIA de una política, y una ausencia se
-- pierde el día que alguien añada una "para arreglar algo". Con el permiso
-- revocado hacen falta las dos cosas para volver a abrirlo.
REVOKE INSERT, UPDATE, DELETE ON public.hub_template_tests FROM authenticated, anon;
GRANT SELECT ON public.hub_template_tests TO authenticated;

-- ── Consultar el cupo sin gastarlo ──────────────────────────────────
-- La usa la pantalla para enseñar "te quedan N".
CREATE OR REPLACE FUNCTION public.hub_test_quota(p_template_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_plantilla INT;
  v_dia INT;
BEGIN
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error', 'Sin sesión');
  END IF;

  SELECT count(*) INTO v_plantilla
  FROM hub_template_tests
  WHERE hub_owner_id = v_owner
    AND template_id = p_template_id
    AND sent_at >= date_trunc('day', now());

  SELECT count(*) INTO v_dia
  FROM hub_template_tests
  WHERE hub_owner_id = v_owner
    AND sent_at >= date_trunc('day', now());

  RETURN jsonb_build_object(
    'per_template_limit', 2,
    'per_template_used',  v_plantilla,
    'remaining',          GREATEST(2 - v_plantilla, 0),
    'daily_limit',        10,
    'daily_used',         v_dia
  );
END;
$$;

-- ── Consumir una prueba ─────────────────────────────────────────────
-- Comprueba y anota en la misma llamada. Separar las dos cosas dejaría un
-- hueco entre la comprobación y la inserción por el que se cuelan dos
-- pulsaciones rápidas del botón.
CREATE OR REPLACE FUNCTION public.hub_consume_test(
  p_hub_owner_id UUID,
  p_template_id  UUID,
  p_sent_to      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plantilla INT;
  v_dia INT;
  v_test_id UUID;
BEGIN
  -- Se bloquea la cuenta mientras se cuenta y se inserta, para que dos
  -- peticiones simultáneas no lean las dos el mismo "queda una".
  PERFORM pg_advisory_xact_lock(hashtext('hub_test_' || p_hub_owner_id::text));

  SELECT count(*) INTO v_plantilla
  FROM hub_template_tests
  WHERE hub_owner_id = p_hub_owner_id
    AND template_id = p_template_id
    AND sent_at >= date_trunc('day', now());

  IF v_plantilla >= 2 THEN
    RETURN jsonb_build_object(
      'allowed', false, 'reason', 'per_template',
      'used', v_plantilla, 'remaining', 0);
  END IF;

  SELECT count(*) INTO v_dia
  FROM hub_template_tests
  WHERE hub_owner_id = p_hub_owner_id
    AND sent_at >= date_trunc('day', now());

  IF v_dia >= 10 THEN
    RETURN jsonb_build_object(
      'allowed', false, 'reason', 'daily',
      'used', v_plantilla, 'remaining', 0, 'daily_used', v_dia);
  END IF;

  -- Se devuelve el identificador de la fila para poder deshacerla exacta si
  -- el envío falla. Borrar "la última" con order+limit no vale: PostgREST no
  -- admite LIMIT en un DELETE, y por id es inequívoco.
  INSERT INTO hub_template_tests (hub_owner_id, template_id, sent_to)
  VALUES (p_hub_owner_id, p_template_id, p_sent_to)
  RETURNING id INTO v_test_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'test_id', v_test_id,
    'used', v_plantilla + 1,
    'remaining', 2 - (v_plantilla + 1),
    'daily_used', v_dia + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.hub_test_quota(UUID)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hub_test_quota(UUID)       TO authenticated;

-- Consumir cupo solo desde la función de envío, con la clave de servicio.
REVOKE ALL ON FUNCTION public.hub_consume_test(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.hub_consume_test(UUID, UUID, TEXT) IS
  'Comprueba y anota una prueba en la misma transacción. 2 por plantilla '
  'y día, 10 al día por cuenta. La llama hub-template-preview.';
