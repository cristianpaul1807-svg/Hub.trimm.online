-- Prueba del saldo comprado: acreditación idempotente y retirada por
-- devolución o disputa.
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

DO $test$
DECLARE
  v_owner   uuid := gen_random_uuid();
  v_biz     uuid := gen_random_uuid();
  v_pi      text := 'pi_test_recarga_1';
  v_res     jsonb;
  v_balance int;
  v_ledger  int;
  v_lots    int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'duena@grupo.com');
  INSERT INTO public.businesses (id, owner_id, name, slug)
    VALUES (v_biz, v_owner, 'Salón Centro', 'salon-centro');
  PERFORM set_config('test.uid', v_owner::text, false);

  -- ── 1. La compra acredita el saldo del pack ───────────────────────
  v_res := hub_credit_purchase(v_owner, 'recarga', v_pi);
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '1. Compra de "recarga": saldo % (esperado 1000)', v_balance;
  ASSERT (v_res->>'success')::boolean, 'La compra deberia funcionar';
  ASSERT v_balance = 1000, 'El saldo deberia ser 1000';

  -- ── 2. El mismo PaymentIntent no duplica saldo ────────────────────
  -- Es el caso real: el navegador acredita y el webhook llega después,
  -- o Stripe reintenta el evento.
  v_res := hub_credit_purchase(v_owner, 'recarga', v_pi);
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '2. Mismo PaymentIntent otra vez: duplicate=%, saldo % (esperado 1000)',
    v_res->>'duplicate', v_balance;
  ASSERT (v_res->>'duplicate')::boolean, 'Deberia detectarse como duplicado';
  ASSERT v_balance = 1000, 'El saldo no deberia duplicarse';

  SELECT count(*) INTO v_lots FROM hub_credit_lots WHERE hub_owner_id = v_owner;
  ASSERT v_lots = 1, 'Solo deberia existir un lote';

  -- ── 3. Se gasta una parte ─────────────────────────────────────────
  v_res := hub_consume_credits(v_owner, 300, NULL, 'campaign');
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '3. Gastados 300: saldo % (esperado 700)', v_balance;
  ASSERT v_balance = 700, 'El saldo deberia ser 700';

  -- ── 4. Devolución: se retira lo que queda, no lo gastado ──────────
  v_res := hub_revoke_purchase(v_pi, 'refund', 'Stripe: charge.refunded');
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '4. Devolución: retirados %, ya gastados %, saldo % (esperado 700 / 300 / 0)',
    v_res->>'revoked', v_res->>'already_spent', v_balance;
  ASSERT (v_res->>'revoked')::int = 700, 'Deberian retirarse 700';
  ASSERT (v_res->>'already_spent')::int = 300, 'Deberian constar 300 gastados';
  ASSERT v_balance = 0, 'El saldo deberia quedar a cero';

  -- El saldo no se deja en negativo: los correos ya salieron y no vuelven.
  SELECT credits_remaining INTO v_lots FROM hub_credit_lots
   WHERE stripe_payment_intent_id = v_pi;
  ASSERT v_lots = 0, 'El lote deberia quedar a cero, nunca en negativo';

  -- ── 5. Retirar dos veces no resta de más ──────────────────────────
  v_res := hub_revoke_purchase(v_pi, 'refund');
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '5. Segunda retirada: retirados % (esperado 0), saldo %',
    v_res->>'revoked', v_balance;
  ASSERT (v_res->>'revoked')::int = 0, 'No deberia retirar nada la segunda vez';
  ASSERT v_balance = 0, 'El saldo deberia seguir a cero';

  -- ── 6. Un cobro ajeno al Hub no rompe nada ────────────────────────
  -- La cuenta de Stripe es la misma que la de Trimm: por el webhook pasan
  -- devoluciones de suscripciones Pro que aquí no tienen lote.
  v_res := hub_revoke_purchase('pi_de_trimm_no_existe', 'refund');
  RAISE NOTICE '6. Cobro ajeno: success=%, not_found=%',
    v_res->>'success', v_res->>'not_found';
  ASSERT (v_res->>'success')::boolean, 'No deberia ser un error';
  ASSERT (v_res->>'not_found')::boolean, 'Deberia indicar que no lo encuentra';

  -- ── 7. Todo queda anotado en el libro mayor ───────────────────────
  SELECT count(*) INTO v_ledger FROM hub_credit_ledger WHERE hub_owner_id = v_owner;
  RAISE NOTICE '7. Apuntes en el libro mayor: % (compra, consumo, retirada)', v_ledger;
  ASSERT v_ledger = 3, 'Deberian ser 3 apuntes';

  SELECT delta_credits INTO v_lots FROM hub_credit_ledger
   WHERE hub_owner_id = v_owner AND reason = 'refund';
  ASSERT v_lots = -700, 'El apunte de retirada deberia ser -700';

  -- ── 8. Comprar de nuevo tras la devolución funciona ───────────────
  v_res := hub_credit_purchase(v_owner, 'salon', 'pi_test_salon_2');
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '8. Nueva compra "salon": saldo % (esperado 5000)', v_balance;
  ASSERT v_balance = 5000, 'El saldo deberia ser 5000';

  RAISE NOTICE '';
  RAISE NOTICE 'Todas las comprobaciones del saldo comprado han pasado.';
END
$test$;
