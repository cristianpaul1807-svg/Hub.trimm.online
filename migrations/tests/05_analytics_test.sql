-- Análisis completo: composición del negocio.
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_biz   uuid := gen_random_uuid();
  v_corte uuid := gen_random_uuid();
  v_tinte uuid := gen_random_uuid();
  v_emp   uuid := gen_random_uuid();
  v_c1    uuid; v_c2 uuid;
  -- Un lunes fijo, para que las aserciones de día y hora no dependan de
  -- cuándo se ejecute la prueba.
  v_lunes timestamptz := date_trunc('week', now() - interval '7 days');
  v_from  timestamptz := v_lunes - interval '1 day';
  v_to    timestamptz := v_lunes + interval '6 days';
  r jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'analitica@grupo.com');
  INSERT INTO public.businesses (id, owner_id, name, slug) VALUES (v_biz, v_owner, 'Centro', 'centro-an');
  INSERT INTO public.hub_connections (hub_owner_id, business_id) VALUES (v_owner, v_biz);
  INSERT INTO public.staff (id, business_id, name, active) VALUES (v_emp, v_biz, 'Chris', true);
  INSERT INTO public.services (id, business_id, name, duration_minutes, price, active) VALUES
    (v_corte, v_biz, 'Corte', 30, 20, true),
    (v_tinte, v_biz, 'Tinte', 60, 50, true);

  -- Lunes a sábado, de 9 a 17 sin descanso: 8 h = 480 min por día.
  INSERT INTO public.business_working_hours (business_id, day_of_week, open_time, close_time)
  SELECT v_biz, d, '09:00', '17:00' FROM generate_series(1, 6) d;

  INSERT INTO public.clients (name, email, business_id) VALUES ('Ana','ana.an@x.com', v_biz) RETURNING id INTO v_c1;
  INSERT INTO public.clients (name, email, business_id) VALUES ('Leo','leo.an@x.com', v_biz) RETURNING id INTO v_c2;

  -- Lunes: dos cortes a las 10 y un tinte a las 16. Ana repite.
  -- duration_minutes va a 0 a propósito: es como está en produccion, donde
  -- la columna nunca se rellena. La duracion real sale de end_time.
  INSERT INTO public.appointments
    (business_id, client_id, staff_id, service_id, status, price, duration_minutes,
     start_time, end_time, created_at)
  VALUES
    (v_biz, v_c1, v_emp, v_corte, 'COMPLETED', 20, 0,
       v_lunes + interval '10 hours', v_lunes + interval '10 hours 30 min', v_lunes - interval '3 days'),
    (v_biz, v_c2, v_emp, v_corte, 'COMPLETED', 20, 0,
       v_lunes + interval '10 hours 30 min', v_lunes + interval '11 hours', v_lunes + interval '9 hours'),
    (v_biz, v_c1, v_emp, v_tinte, 'COMPLETED', 50, 0,
       v_lunes + interval '16 hours', v_lunes + interval '17 hours', v_lunes - interval '10 days'),
    (v_biz, v_c2, v_emp, v_corte, 'CANCELLED', 20, 0,
       v_lunes + interval '11 hours', v_lunes + interval '11 hours 30 min', v_lunes - interval '1 day');

  PERFORM set_config('test.uid', v_owner::text, false);
  r := get_hub_analytics(ARRAY[v_biz], v_from, v_to);

  -- ── 1. Servicios, el que más factura primero ──────────────────────
  RAISE NOTICE '1. Servicios: "%" %€ / "%" %€',
    r->'services'->0->>'name', r->'services'->0->>'revenue',
    r->'services'->1->>'name', r->'services'->1->>'revenue';
  ASSERT r->'services'->0->>'name' = 'Tinte', 'El tinte deberia ir primero (50 > 40)';
  ASSERT (r->'services'->0->>'revenue')::numeric = 50, 'Tinte deberia facturar 50';
  ASSERT (r->'services'->1->>'appointments')::int = 2, 'Deberian ser 2 cortes completados';
  -- Con duration_minutes a 0, la duracion tiene que salir de end_time.
  RAISE NOTICE '   duración media del tinte: % min (esperado 60, no 0)', r->'services'->0->>'avg_minutes';
  ASSERT (r->'services'->0->>'avg_minutes')::numeric = 60, 'La duracion debe salir de end_time';

  -- ── 2. Franja horaria punta ───────────────────────────────────────
  ASSERT jsonb_array_length(r->'hours') = 24, 'Deberian venir las 24 horas';
  RAISE NOTICE '2. A las 10h hay % citas (esperado 2); la cancelada de las 11h no cuenta: %',
    r->'hours'->10->>'appointments', r->'hours'->11->>'appointments';
  ASSERT (r->'hours'->10->>'appointments')::int = 2, 'A las 10 deberian ser 2';
  ASSERT (r->'hours'->11->>'appointments')::int = 0, 'La cancelada no debe contar como cita';

  -- ── 3. Días de la semana, los siete siempre ───────────────────────
  ASSERT jsonb_array_length(r->'weekdays') = 7, 'Deberian venir los 7 dias';
  RAISE NOTICE '3. Lunes: % citas, % canceladas',
    r->'weekdays'->1->>'appointments', r->'weekdays'->1->>'cancelled';
  ASSERT (r->'weekdays'->1->>'appointments')::int = 3, 'El lunes deberian ser 3 completadas';
  ASSERT (r->'weekdays'->1->>'cancelled')::int = 1,    'Y 1 cancelada';

  -- ── 4. Ocupación ──────────────────────────────────────────────────
  -- 120 min ocupados (30+30+60; la cancelada no ocupa) sobre 6 días
  -- abiertos × 480 min × 1 empleado = 2880.
  RAISE NOTICE '4. Ocupación: % min de % (%%: %)',
    r->'occupancy'->>'booked_minutes', r->'occupancy'->>'capacity_minutes',
    r->'occupancy'->>'rate';
  ASSERT (r->'occupancy'->>'booked_minutes')::numeric = 120, 'Deberian ser 120 minutos ocupados';
  ASSERT (r->'occupancy'->>'capacity_minutes')::numeric = 2880, 'La capacidad deberia ser 2880';
  ASSERT (r->'occupancy'->>'active_staff')::int = 1, 'Deberia contar 1 empleado activo';

  -- ── 5. Antelación de reserva ──────────────────────────────────────
  RAISE NOTICE '5. Antelación media % días; mismo día: %, más de una semana: %',
    r->'lead_time'->>'avg_days',
    r->'lead_time'->'buckets'->>'same_day', r->'lead_time'->'buckets'->>'over_week';
  ASSERT (r->'lead_time'->'buckets'->>'same_day')::int = 1,  'Una se reservó el mismo día';
  ASSERT (r->'lead_time'->'buckets'->>'over_week')::int = 1, 'Una con 10 días de antelación';

  -- ── 6. Clientes ───────────────────────────────────────────────────
  RAISE NOTICE '6. Clientes: % con visitas, % repiten, % de una sola vez',
    r->'clients'->>'with_visits', r->'clients'->>'repeaters', r->'clients'->>'one_timers';
  ASSERT (r->'clients'->>'with_visits')::int = 2, 'Deberian ser 2 clientes con visitas';
  ASSERT (r->'clients'->>'repeaters')::int = 1,   'Solo Ana repite';
  ASSERT (r->'clients'->>'one_timers')::int = 1,  'Leo vino una vez';

  -- ── 7. Ranking de clientes por gasto ──────────────────────────────
  RAISE NOTICE '7. Mejor cliente: "%" con %€',
    r->'top_clients'->0->>'name', r->'top_clients'->0->>'spend';
  ASSERT r->'top_clients'->0->>'name' = 'Ana', 'Ana gasta 70, Leo 20';
  ASSERT (r->'top_clients'->0->>'spend')::numeric = 70, 'Ana deberia sumar 70';

  -- ── 8. Sin horario configurado no se inventa un porcentaje ────────
  DELETE FROM public.business_working_hours WHERE business_id = v_biz;
  r := get_hub_analytics(ARRAY[v_biz], v_from, v_to);
  RAISE NOTICE '8. Sin horario, la ocupación es % (esperado nulo, no 0%%)',
    COALESCE(r->'occupancy'->>'rate', 'nula');
  ASSERT r->'occupancy'->'rate' = 'null'::jsonb, 'Sin horario no debe darse un porcentaje';

  -- ── 8b. Las horas se miden en la zona del negocio ─────────────────
  -- El mismo instante visto desde Roma y desde La Habana no es la misma
  -- hora del día. Sin esto, la hora punta de cada sucursal sale movida.
  UPDATE public.businesses SET timezone = 'Europe/Rome' WHERE id = v_biz;
  r := get_hub_analytics(ARRAY[v_biz], v_from, v_to);
  DECLARE v_roma int; v_habana int;
  BEGIN
    SELECT (h->>'hour')::int INTO v_roma
    FROM jsonb_array_elements(r->'hours') h
    WHERE (h->>'appointments')::int = 2 LIMIT 1;

    UPDATE public.businesses SET timezone = 'America/Havana' WHERE id = v_biz;
    r := get_hub_analytics(ARRAY[v_biz], v_from, v_to);
    SELECT (h->>'hour')::int INTO v_habana
    FROM jsonb_array_elements(r->'hours') h
    WHERE (h->>'appointments')::int = 2 LIMIT 1;

    RAISE NOTICE '8b. Misma cita: %h en Roma, %h en La Habana', v_roma, v_habana;
    ASSERT v_roma <> v_habana, 'La hora debe depender de la zona del negocio';
  END;

  -- Una zona inválida no debe tumbar la consulta.
  UPDATE public.businesses SET timezone = 'No/Existe' WHERE id = v_biz;
  r := get_hub_analytics(ARRAY[v_biz], v_from, v_to);
  RAISE NOTICE '8c. Zona inválida: la consulta sigue respondiendo (% servicios)',
    jsonb_array_length(r->'services');
  ASSERT jsonb_array_length(r->'services') = 2, 'Con zona invalida debe caer a UTC, no fallar';

  -- ── 9. Negocio ajeno ──────────────────────────────────────────────
  BEGIN
    PERFORM get_hub_analytics(ARRAY[gen_random_uuid()], v_from, v_to);
    RAISE EXCEPTION 'FUGA: acepto un negocio ajeno';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF position('FUGA' in SQLERRM) > 0 THEN RAISE; END IF;
    RAISE NOTICE '9. Negocio ajeno rechazado: %', SQLERRM;
  END;

  RAISE NOTICE '';
  RAISE NOTICE 'Análisis verificado.';
END
$test$;
