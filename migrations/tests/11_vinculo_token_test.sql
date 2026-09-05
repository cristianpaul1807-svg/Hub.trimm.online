-- Quién puede vincularse una sucursal.
--
-- Nació de un caso real: una cuenta del Hub tenía vinculado un negocio que no
-- era suyo. La política de alta solo comprobaba que la conexión llevara tu
-- propio identificador, no que el negocio tuviera algo que ver contigo.
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

-- Sin estos permisos el INSERT fallaría por privilegios y la prueba pasaría
-- por el motivo equivocado: hay que llegar hasta la política.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.hub_connections TO authenticated;
GRANT SELECT ON public.businesses TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hub_token(text) TO authenticated;

DO $test$
DECLARE
  v_duena    uuid := gen_random_uuid();  -- dueña de Vital Touch
  v_vecino   uuid := gen_random_uuid();  -- otra cuenta del Hub, con sesión
  v_biz      uuid := gen_random_uuid();  -- el negocio de la dueña
  v_suyo     uuid := gen_random_uuid();  -- el negocio del vecino
  v_token    text := 'tokendeprueba0001';
  v_filas    int;
  v_res      jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_duena,  'duena@vinculo.com'),
    (v_vecino, 'vecino@vinculo.com');
  INSERT INTO public.businesses (id, owner_id, name, slug) VALUES
    (v_biz,  v_duena,  'Vital Touch',  'vital-touch-test'),
    (v_suyo, v_vecino, 'Su Barbería',  'su-barberia-test');

  -- ── 1. El intruso no puede vincularse un negocio ajeno ────────────
  -- El id del negocio lo conoce cualquiera: la página de reserva es pública.
  SET ROLE authenticated;
  PERFORM set_config('test.uid', v_vecino::text, false);
  BEGIN
    INSERT INTO public.hub_connections (hub_owner_id, business_id)
      VALUES (v_vecino, v_biz);
    RESET ROLE;
    RAISE EXCEPTION 'FUGA: una cuenta cualquiera se ha vinculado un negocio ajeno';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE '1. Negocio ajeno sin token: rechazado';
  END;

  -- ── 2. El dueño sí puede vincularse el suyo ───────────────────────
  SET ROLE authenticated;
  PERFORM set_config('test.uid', v_vecino::text, false);
  INSERT INTO public.hub_connections (hub_owner_id, business_id)
    VALUES (v_vecino, v_suyo);
  RESET ROLE;
  SELECT count(*) INTO v_filas FROM public.hub_connections
    WHERE hub_owner_id = v_vecino AND business_id = v_suyo;
  RAISE NOTICE '2. Negocio propio: vinculado (% fila)', v_filas;
  ASSERT v_filas = 1, 'El dueño debe poder vincular su propio negocio';

  -- ── 3. Con el token de la dueña, sí entra ─────────────────────────
  -- El camino legítimo para un grupo que gestiona negocios de otros.
  INSERT INTO public.hub_claim_tokens (business_id, token)
    VALUES (v_biz, v_token);

  PERFORM set_config('test.uid', v_vecino::text, false);
  SELECT public.claim_hub_token(v_token) INTO v_res;
  RAISE NOTICE '3. Con token: %', v_res->>'success';
  ASSERT (v_res->>'success')::boolean, 'El token debe seguir vinculando: ' || coalesce(v_res->>'error','');

  -- ── 4. El mismo token no vale dos veces ───────────────────────────
  DELETE FROM public.hub_connections
    WHERE hub_owner_id = v_vecino AND business_id = v_biz;
  SELECT public.claim_hub_token(v_token) INTO v_res;
  RAISE NOTICE '4. Token reutilizado: %', v_res->>'error';
  ASSERT NOT (v_res->>'success')::boolean, 'Un token gastado no puede volver a usarse';

  RAISE NOTICE '✓ Vínculo de sucursales: 4 comprobaciones correctas';
END
$test$;
