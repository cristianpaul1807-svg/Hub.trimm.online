-- Un correo por sucursal para quien es cliente de varias.
\set ON_ERROR_STOP on
\pset pager off

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_a     uuid := gen_random_uuid();   -- sucursal A
  v_b     uuid := gen_random_uuid();   -- sucursal B
  v_camp  uuid;
  n int;
  v_firmantes int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'grupo@dos.com');
  INSERT INTO public.businesses (id, owner_id, name, slug) VALUES
    (v_a, v_owner, 'Salón A', 'salon-a'),
    (v_b, v_owner, 'Salón B', 'salon-b');
  INSERT INTO public.hub_connections (hub_owner_id, business_id, marketing_allowed) VALUES
    (v_owner, v_a, true), (v_owner, v_b, true);

  -- Ana es clienta de las dos, con el mismo correo. Bruno solo de A.
  INSERT INTO public.clients (name, email, business_id, preferencia_email) VALUES
    ('Ana',   'ana@x.com',   v_a, true),
    ('Ana',   'ana@x.com',   v_b, true),
    ('Bruno', 'bruno@x.com', v_a, true);

  PERFORM set_config('test.uid', v_owner::text, false);

  -- ── 1. Ana cuenta dos veces, una por salón ────────────────────────
  SELECT count(*) INTO n
  FROM hub_resolve_audience(v_owner, ARRAY[v_a, v_b], 'discount', 30);
  RAISE NOTICE '1. Audiencia de las dos sucursales: % (Ana ×2 + Bruno)', n;
  ASSERT n = 3, 'Ana deberia contar una vez por cada salon';

  SELECT count(DISTINCT business_id) INTO v_firmantes
  FROM hub_resolve_audience(v_owner, ARRAY[v_a, v_b], 'discount', 30)
  WHERE email = 'ana@x.com';
  RAISE NOTICE '2. Sucursales que le escriben a Ana: %', v_firmantes;
  ASSERT v_firmantes = 2, 'Cada salon debe escribirle por su cuenta';

  -- ── 3. Con una sola sucursal, un solo correo ──────────────────────
  SELECT count(*) INTO n
  FROM hub_resolve_audience(v_owner, ARRAY[v_a], 'discount', 30);
  RAISE NOTICE '3. Solo la sucursal A: % (Ana + Bruno)', n;
  ASSERT n = 2, 'Dirigiendose a una sola sucursal, un correo por persona';

  -- ── 4. Dos fichas en el MISMO salón siguen siendo un correo ───────
  -- Es la misma persona apuntada dos veces; el segundo correo solo molesta.
  INSERT INTO public.clients (name, email, business_id, preferencia_email)
  VALUES ('Ana (duplicada)', 'ana@x.com', v_a, true);

  SELECT count(*) INTO n
  FROM hub_resolve_audience(v_owner, ARRAY[v_a], 'discount', 30);
  RAISE NOTICE '4. Con una ficha duplicada en A: % (sigue siendo 2)', n;
  ASSERT n = 2, 'Dentro de un salon si se deduplica';

  -- ── 5. Lo que se enseña es lo que se materializa ──────────────────
  -- Si la cifra del selector y la de la cola no coincidieran, se cobraría
  -- una cosa y se enviaría otra.
  INSERT INTO public.hub_campaigns (hub_owner_id, template_type, discount_value,
                                    target_business_ids, status)
  VALUES (v_owner, 'discount', 10, ARRAY[v_a, v_b], 'draft')
  RETURNING id INTO v_camp;

  SELECT hub_materialize_campaign(v_camp, NULL) INTO n;
  RAISE NOTICE '5. Encolados: % (los mismos 3 que se contaron)', n;
  ASSERT n = 3, 'La cola debe coincidir con el recuento';

  SELECT count(*) INTO n
  FROM hub_campaign_recipients WHERE campaign_id = v_camp AND email = 'ana@x.com';
  RAISE NOTICE '6. Filas de Ana en la cola: %', n;
  ASSERT n = 2, 'Ana deberia tener una fila por salon';

  -- Y cada una con su sucursal, que es lo que decide el nombre y el enlace.
  SELECT count(DISTINCT business_id) INTO v_firmantes
  FROM hub_campaign_recipients WHERE campaign_id = v_camp AND email = 'ana@x.com';
  ASSERT v_firmantes = 2, 'Cada fila debe llevar su propia sucursal';

  -- Y cada una con su token, o las dos bajas serían la misma.
  SELECT count(DISTINCT unsubscribe_token) INTO n
  FROM hub_campaign_recipients WHERE campaign_id = v_camp AND email = 'ana@x.com';
  RAISE NOTICE '7. Tokens distintos para las dos filas de Ana: %', n;
  ASSERT n = 2, 'Cada envio necesita su propio token';

  -- ── 8. Una baja en un salón la calla en los dos ───────────────────
  -- Aquí no se sigue el criterio de arriba a propósito: quien pulsa
  -- «darse de baja» quiere dejar de recibir esto, no matizar de qué salón.
  INSERT INTO public.hub_email_suppressions (email, business_id, reason)
  VALUES ('ana@x.com', v_a, 'unsubscribe');

  SELECT count(*) INTO n
  FROM hub_resolve_audience(v_owner, ARRAY[v_a, v_b], 'discount', 30)
  WHERE email = 'ana@x.com';
  RAISE NOTICE '8. Tras darse de baja en A, correos a Ana: %', n;
  ASSERT n = 0, 'Una baja debe callar las dos sucursales';

  RAISE NOTICE '';
  RAISE NOTICE 'Audiencia por sucursal verificada.';
END
$test$;
