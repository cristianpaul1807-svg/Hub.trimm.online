-- Control de acceso a la audiencia: el dato más sensible del sistema.
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

DO $test$
DECLARE
  v_duena   uuid := gen_random_uuid();   -- dueña legítima del grupo
  v_intrusa uuid := gen_random_uuid();   -- otra clienta del Hub, con sesión
  v_biz     uuid := gen_random_uuid();
  v_count   int;
  v_leak    int;
BEGIN
  -- Correos propios de esta prueba: los tres ficheros comparten base de
  -- datos y la prueba del motor deja bajas y supresiones puestas, que
  -- filtrarían a estos clientes y falsearían el recuento.
  INSERT INTO auth.users (id, email) VALUES
    (v_duena,   'duena@grupo.com'),
    (v_intrusa, 'intrusa@otrogrupo.com');
  INSERT INTO public.businesses (id, owner_id, name, slug)
    VALUES (v_biz, v_duena, 'Salón Centro', 'salon-centro');
  INSERT INTO public.clients (name, email, business_id, preferencia_email) VALUES
    ('Ana',   'ana.acceso@mail.com',   v_biz, true),
    ('Bruno', 'bruno.acceso@mail.com', v_biz, true);
  INSERT INTO public.hub_connections (hub_owner_id, business_id, marketing_allowed)
    VALUES (v_duena, v_biz, true);

  -- ── 1. La dueña ve su propia audiencia ────────────────────────────
  PERFORM set_config('test.uid', v_duena::text, false);
  SELECT count(*) INTO v_count
  FROM hub_resolve_audience(v_duena, ARRAY[v_biz], 'discount', 30);
  RAISE NOTICE '1. La dueña resuelve su audiencia: % (esperado 2)', v_count;
  ASSERT v_count = 2, 'La dueña deberia ver sus 2 clientes';

  -- ── 2. La intrusa, con sesión, no ─────────────────────────────────
  -- Conoce el id de la dueña y el de la sucursal: sin la comprobación se
  -- llevaría los nombres y correos de sus clientes.
  PERFORM set_config('test.uid', v_intrusa::text, false);
  BEGIN
    SELECT count(*) INTO v_leak
    FROM hub_resolve_audience(v_duena, ARRAY[v_biz], 'discount', 30);
    RAISE EXCEPTION 'FUGA: la intrusa ha obtenido % contactos ajenos', v_leak;
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF position('FUGA' in SQLERRM) > 0 THEN RAISE; END IF;
    RAISE NOTICE '2. Audiencia ajena denegada: %', SQLERRM;
  END;

  -- ── 3. Tampoco pasando su propio id con la sucursal ajena ─────────
  BEGIN
    SELECT count(*) INTO v_leak
    FROM hub_resolve_audience(v_intrusa, ARRAY[v_biz], 'discount', 30);
    RAISE EXCEPTION 'FUGA: sucursal ajena aceptada, % contactos', v_leak;
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF position('FUGA' in SQLERRM) > 0 THEN RAISE; END IF;
    RAISE NOTICE '3. Sucursal ajena denegada: %', SQLERRM;
  END;

  -- ── 4. El recuento del interfaz sigue funcionando ─────────────────
  -- Pasa por get_campaign_recipient_count, que usa auth.uid().
  PERFORM set_config('test.uid', v_duena::text, false);
  SELECT get_campaign_recipient_count(ARRAY[v_biz], 'discount', 30) INTO v_count;
  RAISE NOTICE '4. Recuento del interfaz: % (esperado 2)', v_count;
  ASSERT v_count = 2, 'El recuento deberia seguir dando 2';

  -- ── 5. La clave de servicio sigue pudiendo (no hay sesión) ────────
  -- Es el camino del worker y de hub_materialize_campaign.
  PERFORM set_config('test.uid', '', false);
  SELECT count(*) INTO v_count
  FROM hub_resolve_audience(v_duena, ARRAY[v_biz], 'discount', 30);
  RAISE NOTICE '5. Sin sesión (clave de servicio): % (esperado 2)', v_count;
  ASSERT v_count = 2, 'El worker deberia seguir resolviendo la audiencia';

  RAISE NOTICE '';
  RAISE NOTICE 'El acceso a la audiencia queda cerrado.';
END
$test$;
