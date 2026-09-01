-- KPIs: comparación con el periodo anterior, tendencia y desglose.
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_a     uuid := gen_random_uuid();   -- sucursal que factura
  v_b     uuid := gen_random_uuid();   -- sucursal floja
  v_c1    uuid;
  v_c2    uuid;
  v_from  timestamptz := date_trunc('day', now()) - interval '30 days';
  v_to    timestamptz := now();
  r       jsonb;
  v_meses int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'kpis@grupo.com');
  INSERT INTO public.businesses (id, owner_id, name, slug) VALUES
    (v_a, v_owner, 'Centro ', 'centro'),      -- con espacio final a propósito
    (v_b, v_owner, 'Norte',   'norte');
  INSERT INTO public.hub_connections (hub_owner_id, business_id) VALUES
    (v_owner, v_a), (v_owner, v_b);

  INSERT INTO public.clients (name, email, business_id) VALUES ('Ana','ana.kpi@x.com', v_a) RETURNING id INTO v_c1;
  INSERT INTO public.clients (name, email, business_id) VALUES ('Leo','leo.kpi@x.com', v_a) RETURNING id INTO v_c2;

  -- Periodo anterior: Ana ya vino y dejó 50.
  INSERT INTO public.appointments (business_id, client_id, status, price, start_time) VALUES
    (v_a, v_c1, 'COMPLETED', 50, now() - interval '45 days');

  -- Periodo actual: Ana repite (100), Leo es nuevo (40), una cancelada,
  -- y una en la sucursal floja.
  INSERT INTO public.appointments (business_id, client_id, status, price, start_time) VALUES
    (v_a, v_c1, 'COMPLETED', 100, now() - interval '5 days'),
    (v_a, v_c2, 'COMPLETED',  40, now() - interval '4 days'),
    (v_a, v_c2, 'CANCELLED',  30, now() - interval '3 days'),
    (v_b, v_c1, 'COMPLETED',  10, now() - interval '2 days');

  PERFORM set_config('test.uid', v_owner::text, false);
  r := get_hub_kpis(ARRAY[v_a, v_b], v_from, v_to);

  -- ── 1. Periodo actual ─────────────────────────────────────────────
  RAISE NOTICE '1. Actual: facturado %, completadas %, canceladas % (esperado 150 / 3 / 1)',
    r->'current'->>'revenue', r->'current'->>'completed', r->'current'->>'cancelled';
  ASSERT (r->'current'->>'revenue')::numeric = 150, 'La facturacion deberia ser 150';
  ASSERT (r->'current'->>'completed')::int = 3,     'Deberian ser 3 completadas';
  ASSERT (r->'current'->>'cancelled')::int = 1,     'Deberia haber 1 cancelada';

  -- La cancelada no cuenta como dinero: es el fallo que tenia get_hub_metrics.
  ASSERT (r->'current'->>'revenue')::numeric <> 180, 'La cancelada no debe sumar a la facturacion';

  -- ── 2. Periodo anterior, calculado solo ───────────────────────────
  RAISE NOTICE '2. Anterior: facturado %, completadas % (esperado 50 / 1)',
    r->'previous'->>'revenue', r->'previous'->>'completed';
  ASSERT (r->'previous'->>'revenue')::numeric = 50, 'El periodo anterior deberia ser 50';
  ASSERT (r->'previous'->>'completed')::int = 1,    'Deberia haber 1 completada antes';

  -- ── 3. Repetidores frente a nuevos ────────────────────────────────
  RAISE NOTICE '3. Clientes: % distintos, % repetidores (esperado 2 / 1: Ana repite, Leo es nuevo)',
    r->'current'->>'clients', r->'current'->>'returning';
  ASSERT (r->'current'->>'clients')::int = 2,   'Deberian ser 2 clientes distintos';
  ASSERT (r->'current'->>'returning')::int = 1, 'Solo Ana habia venido antes';

  -- ── 4. Doce meses, huecos incluidos ───────────────────────────────
  SELECT jsonb_array_length(r->'months') INTO v_meses;
  RAISE NOTICE '4. Meses en la serie: % (esperado 12, con los vacios)', v_meses;
  ASSERT v_meses = 12, 'La serie deberia traer los 12 meses';

  -- ── 5. Desglose por sucursal, la que mas factura primero ──────────
  RAISE NOTICE '5. Sucursales: 1a "%" con %, 2a "%" con %',
    r->'branches'->0->>'name', r->'branches'->0->>'revenue',
    r->'branches'->1->>'name', r->'branches'->1->>'revenue';
  ASSERT jsonb_array_length(r->'branches') = 2, 'Deberian salir las 2 sucursales';
  ASSERT (r->'branches'->0->>'revenue')::numeric = 140, 'Centro deberia facturar 140';
  ASSERT (r->'branches'->1->>'revenue')::numeric = 10,  'Norte deberia facturar 10';
  -- El nombre llega limpio: en produccion hay negocios con espacio final.
  ASSERT r->'branches'->0->>'name' = 'Centro', 'El nombre deberia venir sin espacios sobrantes';

  -- ── 6. Una sucursal ajena se rechaza ──────────────────────────────
  BEGIN
    PERFORM get_hub_kpis(ARRAY[gen_random_uuid()], v_from, v_to);
    RAISE EXCEPTION 'FUGA: acepto una sucursal ajena';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF position('FUGA' in SQLERRM) > 0 THEN RAISE; END IF;
    RAISE NOTICE '6. Sucursal ajena rechazada: %', SQLERRM;
  END;

  -- ── 7. get_hub_metrics ya no cuenta las canceladas ────────────────
  r := get_hub_metrics(ARRAY[v_a, v_b], v_from, v_to);
  RAISE NOTICE '7. get_hub_metrics factura % (esperado 150, no 180)', r->>'total_revenue';
  ASSERT (r->>'total_revenue')::numeric = 150, 'get_hub_metrics no debe sumar canceladas';

  RAISE NOTICE '';
  RAISE NOTICE 'KPIs verificados.';
END
$test$;
