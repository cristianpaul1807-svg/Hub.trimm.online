-- Cupo de correos de prueba: 2 por plantilla y día, 10 al día por cuenta.
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

DO $test$
DECLARE
  v_a    uuid := gen_random_uuid();   -- una cuenta
  v_b    uuid := gen_random_uuid();   -- otra cuenta
  v_t1   uuid := gen_random_uuid();   -- plantilla 1
  v_t2   uuid := gen_random_uuid();   -- plantilla 2
  r      jsonb;
  i      int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_a, 'a@grupo.com'), (v_b, 'b@grupo.com');

  -- ── 1. Las dos primeras pasan ─────────────────────────────────────
  r := hub_consume_test(v_a, v_t1, 'a@grupo.com');
  RAISE NOTICE '1. Primera prueba: permitida=%, quedan %', r->>'allowed', r->>'remaining';
  ASSERT (r->>'allowed')::boolean, 'La primera deberia pasar';
  ASSERT (r->>'remaining')::int = 1, 'Deberia quedar 1';

  r := hub_consume_test(v_a, v_t1, 'a@grupo.com');
  RAISE NOTICE '2. Segunda prueba: permitida=%, quedan %', r->>'allowed', r->>'remaining';
  ASSERT (r->>'allowed')::boolean, 'La segunda deberia pasar';
  ASSERT (r->>'remaining')::int = 0, 'No deberia quedar ninguna';

  -- ── 3. La tercera no ──────────────────────────────────────────────
  r := hub_consume_test(v_a, v_t1, 'a@grupo.com');
  RAISE NOTICE '3. Tercera prueba: permitida=%, motivo=%', r->>'allowed', r->>'reason';
  ASSERT NOT (r->>'allowed')::boolean, 'La tercera NO deberia pasar';
  ASSERT r->>'reason' = 'per_template', 'El motivo deberia ser el cupo por plantilla';

  -- ── 4. Otra plantilla tiene su propio cupo ────────────────────────
  r := hub_consume_test(v_a, v_t2, 'a@grupo.com');
  RAISE NOTICE '4. Otra plantilla: permitida=%, quedan %', r->>'allowed', r->>'remaining';
  ASSERT (r->>'allowed')::boolean, 'Cada plantilla tiene su propio cupo';

  -- ── 5. Otra cuenta no consume el cupo de la primera ───────────────
  r := hub_consume_test(v_b, v_t1, 'b@grupo.com');
  RAISE NOTICE '5. Otra cuenta, misma plantilla: permitida=%', r->>'allowed';
  ASSERT (r->>'allowed')::boolean, 'El cupo es por cuenta y plantilla';

  -- ── 6. Tope diario por cuenta ─────────────────────────────────────
  -- Ya lleva 3 (2 de t1 + 1 de t2). Con plantillas nuevas se llega a 10.
  FOR i IN 1..7 LOOP
    r := hub_consume_test(v_a, gen_random_uuid(), 'a@grupo.com');
  END LOOP;
  RAISE NOTICE '6. Al llegar a 10 en el día: permitida=%, gastadas hoy %',
    r->>'allowed', r->>'daily_used';
  ASSERT (r->>'daily_used')::int = 10, 'Deberian ser 10 en el dia';

  r := hub_consume_test(v_a, gen_random_uuid(), 'a@grupo.com');
  RAISE NOTICE '7. La undécima: permitida=%, motivo=%', r->>'allowed', r->>'reason';
  ASSERT NOT (r->>'allowed')::boolean, 'La 11 del dia NO deberia pasar';
  ASSERT r->>'reason' = 'daily', 'El motivo deberia ser el tope diario';

  -- ── 8. El cupo se reinicia al día siguiente ───────────────────────
  -- Se envejecen las de hoy para simular el día de mañana.
  UPDATE hub_template_tests SET sent_at = sent_at - interval '1 day'
   WHERE hub_owner_id = v_a;
  r := hub_consume_test(v_a, v_t1, 'a@grupo.com');
  RAISE NOTICE '8. Al día siguiente: permitida=%, quedan %', r->>'allowed', r->>'remaining';
  ASSERT (r->>'allowed')::boolean, 'El cupo deberia reiniciarse cada dia';
  ASSERT (r->>'remaining')::int = 1, 'Y volver a ser 2';

  -- ── 9. Lo que ve la pantalla coincide ─────────────────────────────
  PERFORM set_config('test.uid', v_a::text, false);
  r := hub_test_quota(v_t1);
  RAISE NOTICE '9. La pantalla dice: gastadas %, quedan % (de %)',
    r->>'per_template_used', r->>'remaining', r->>'per_template_limit';
  ASSERT (r->>'per_template_used')::int = 1, 'Deberia contar la de hoy';
  ASSERT (r->>'remaining')::int = 1, 'Y decir que queda 1';

  -- ── 10. Borrar la plantilla no reinicia el cupo ───────────────────
  -- Sin esto, borrar y recrear seria la forma de tener pruebas infinitas.
  ASSERT (SELECT count(*) FROM hub_template_tests
           WHERE hub_owner_id = v_a AND template_id = v_t1) > 0,
    'El historico debe sobrevivir a la plantilla';
  RAISE NOTICE '10. El histórico no depende de que la plantilla exista';

  -- ── 11. Si el envío falla, la prueba se devuelve ─────────────────
  -- hub_consume_test devuelve el id justo para poder deshacerlo.
  DECLARE v_id uuid; v_antes int; BEGIN
    r := hub_consume_test(v_b, v_t2, 'b@grupo.com');
    v_id := (r->>'test_id')::uuid;
    ASSERT v_id IS NOT NULL, 'Deberia devolver el id de la fila';
    SELECT count(*) INTO v_antes FROM hub_template_tests WHERE id = v_id;
    ASSERT v_antes = 1, 'La fila deberia existir';

    DELETE FROM hub_template_tests WHERE id = v_id;
    r := hub_test_quota(v_t2);
    RAISE NOTICE '11. Tras devolver la prueba fallida, la fila ya no está';
  END;

  RAISE NOTICE '';
  RAISE NOTICE 'Cupo de pruebas verificado.';
END
$test$;
