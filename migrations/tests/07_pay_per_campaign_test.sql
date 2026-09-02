-- Pago suelto de una campaña: presupuesto → envíos → importe.
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_biz   uuid := gen_random_uuid();
  r jsonb;
  i int;
  v_saldo int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'pago@grupo.com');
  INSERT INTO public.businesses (id, owner_id, name, slug)
    VALUES (v_biz, v_owner, 'Centro', 'centro-pago');
  INSERT INTO public.hub_connections (hub_owner_id, business_id, marketing_allowed)
    VALUES (v_owner, v_biz, true);

  -- 400 clientes con correo válido y consentimiento.
  FOR i IN 1..400 LOOP
    INSERT INTO public.clients (name, email, business_id, preferencia_email)
    VALUES ('Cliente ' || i, 'pago' || i || '@x.com', v_biz, true);
  END LOOP;

  PERFORM set_config('test.uid', v_owner::text, false);

  -- ── 1. La tarifa es más cara que el peor pack ─────────────────────
  -- Si no, comprar un pack no tendría ningún sentido.
  DECLARE v_tarifa numeric; v_peor numeric; BEGIN
    SELECT direct_rate_cents INTO v_tarifa FROM hub_pricing WHERE id;
    SELECT MAX(price_cents::numeric / credits) INTO v_peor FROM hub_credit_packs WHERE active;
    RAISE NOTICE '1. Tarifa directa % c/envío vs peor pack % c/envío', v_tarifa, round(v_peor, 3);
    ASSERT v_tarifa > v_peor, 'La tarifa directa debe ser mayor que el pack mas caro';
  END;

  -- ── 2. 5 € a 0,02 son 250 envíos ──────────────────────────────────
  r := hub_quote_campaign(ARRAY[v_biz], 'discount', 30, 500);
  RAISE NOTICE '2. Con 5 €: % envíos, se cobran % céntimos (audiencia %)',
    r->>'emails', r->>'amount_cents', r->>'audience';
  ASSERT (r->>'emails')::int = 250, 'Con 5 € deberian ser 250 envios';
  ASSERT (r->>'amount_cents')::int = 500, 'Y cobrarse 5 €';
  ASSERT NOT (r->>'capped_by_audience')::boolean, 'Hay 400 clientes, no se topa';

  -- ── 3. El presupuesto supera la audiencia: se cobra igual ─────────
  -- 20 € compran 1.000 envíos, pero solo hay 400 clientes. Salen 400 y
  -- los otros 600 se quedan en el saldo; por eso se cobran los 20 €.
  r := hub_quote_campaign(ARRAY[v_biz], 'discount', 30, 2000);
  RAISE NOTICE '3. Con 20 €: compra %, salen %, quedan %, se cobran % céntimos',
    r->>'credits', r->>'emails', r->>'leftover', r->>'amount_cents';
  ASSERT (r->>'credits')::int = 1000,     'Con 20 € se compran 1000 envios';
  ASSERT (r->>'emails')::int = 400,       'Pero solo hay 400 destinatarios';
  ASSERT (r->>'leftover')::int = 600,     'Los otros 600 quedan en el saldo';
  ASSERT (r->>'amount_cents')::int = 2000, 'Se cobran los 20 € comprados';
  ASSERT (r->>'capped_by_audience')::boolean, 'Y se avisa de que sobran';

  -- ── 4. El redondeo de envíos va hacia abajo ───────────────────────
  -- 5,05 € dan para 252,5 envíos: se compran 252, no 253.
  r := hub_quote_campaign(ARRAY[v_biz], 'discount', 30, 505);
  RAISE NOTICE '4. Con 5,05 €: % envíos (no 253), se cobran %',
    r->>'credits', r->>'amount_cents';
  ASSERT (r->>'credits')::int = 252, 'Deberia redondear hacia abajo';
  ASSERT (r->>'amount_cents')::int = 504, 'Y cobrar solo los 252 comprados';

  -- ── 4b. Audiencia diminuta: el mínimo sigue siendo cobrable ───────
  -- Es el caso que rompía la pantalla: un negocio recién conectado con 10
  -- clientes. A 0,02 €/envío eso son 0,20 €, que Stripe no cobra. Ahora se
  -- cobran los 5 €, salen los 10 y los 240 restantes quedan de saldo.
  DECLARE
    v_biz2 uuid := gen_random_uuid();
    v_own2 uuid := gen_random_uuid();
    j int;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_own2, 'pocos@grupo.com');
    INSERT INTO public.businesses (id, owner_id, name, slug)
      VALUES (v_biz2, v_own2, 'Peluqueria chica', 'chica-pago');
    INSERT INTO public.hub_connections (hub_owner_id, business_id, marketing_allowed)
      VALUES (v_own2, v_biz2, true);
    FOR j IN 1..10 LOOP
      INSERT INTO public.clients (name, email, business_id, preferencia_email)
      VALUES ('Poco ' || j, 'poco' || j || '@x.com', v_biz2, true);
    END LOOP;

    PERFORM set_config('test.uid', v_own2::text, false);
    r := hub_quote_campaign(ARRAY[v_biz2], 'discount', 30, 500);
    RAISE NOTICE '4b. 10 clientes con 5 €: salen %, quedan %, se cobran %',
      r->>'emails', r->>'leftover', r->>'amount_cents';
    ASSERT (r->>'emails')::int = 10,        'Solo hay 10 destinatarios';
    ASSERT (r->>'leftover')::int = 240,     'El resto queda en el saldo';
    ASSERT (r->>'amount_cents')::int = 500, 'Y el importe es cobrable por Stripe';
    ASSERT (r->>'amount_cents')::int >= 50, 'Nunca por debajo del minimo de Stripe';
    PERFORM set_config('test.uid', v_owner::text, false);
  END;

  -- ── 4c. El presupuesto no puede pasarse del techo ─────────────────
  -- Sin este tope, un cero de más en la pantalla sería un cobro de más.
  r := hub_quote_campaign(ARRAY[v_biz], 'discount', 30, 999999999);
  RAISE NOTICE '4c. Presupuesto desorbitado: se cobran % (techo %)',
    r->>'amount_cents', r->>'max_budget_cents';
  ASSERT (r->>'amount_cents')::int <= (r->>'max_budget_cents')::int,
    'El importe no puede superar el techo configurado';

  -- ── 5. Por debajo del mínimo se avisa ─────────────────────────────
  r := hub_quote_campaign(ARRAY[v_biz], 'discount', 30, 100);
  RAISE NOTICE '5. Con 1 €: below_minimum=%', r->>'below_minimum';
  ASSERT (r->>'below_minimum')::boolean, 'Deberia marcar que esta por debajo del minimo';

  -- ── 6. Sucursal ajena, denegado ───────────────────────────────────
  BEGIN
    PERFORM hub_quote_campaign(ARRAY[gen_random_uuid()], 'discount', 30, 500);
    RAISE EXCEPTION 'FUGA: presupuesto sobre una sucursal ajena';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF position('FUGA' in SQLERRM) > 0 THEN RAISE; END IF;
    RAISE NOTICE '6. Sucursal ajena rechazada: %', SQLERRM;
  END;

  -- ── 7. El cobro acredita exactamente esos envíos ──────────────────
  r := hub_credit_direct(v_owner, 250, 'pi_suelto_1', 500);
  SELECT hub_credit_balance(v_owner) INTO v_saldo;
  RAISE NOTICE '7. Tras pagar: saldo % (esperado 250)', v_saldo;
  ASSERT (r->>'success')::boolean, 'Deberia acreditar';
  ASSERT v_saldo = 250, 'El saldo deberia ser 250';

  -- ── 8. El mismo pago dos veces no duplica saldo ───────────────────
  r := hub_credit_direct(v_owner, 250, 'pi_suelto_1', 500);
  SELECT hub_credit_balance(v_owner) INTO v_saldo;
  RAISE NOTICE '8. Mismo PaymentIntent otra vez: duplicate=%, saldo %',
    r->>'duplicate', v_saldo;
  ASSERT (r->>'duplicate')::boolean, 'Deberia detectarse como duplicado';
  ASSERT v_saldo = 250, 'El saldo no deberia duplicarse';

  -- ── 9. Y la campaña puede gastarlos ───────────────────────────────
  r := hub_consume_credits(v_owner, 250, NULL, 'campaign');
  SELECT hub_credit_balance(v_owner) INTO v_saldo;
  RAISE NOTICE '9. Campaña de 250 envíos: saldo tras enviar % (esperado 0)', v_saldo;
  ASSERT (r->>'success')::boolean, 'Deberia poder gastarlos';
  ASSERT v_saldo = 0, 'Deberia quedar a cero';

  RAISE NOTICE '';
  RAISE NOTICE 'Pago suelto de campaña verificado.';
END
$test$;
