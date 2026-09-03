-- Prueba de extremo a extremo del motor de campañas.
\set ON_ERROR_STOP on
\pset pager off

-- auth.uid() simulado: lee el usuario "en sesión" de una variable de entorno
-- de PostgreSQL, para poder probar las funciones SECURITY DEFINER.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

DO $test$
DECLARE
  v_owner    uuid := gen_random_uuid();
  v_biz      uuid := gen_random_uuid();
  v_biz2     uuid := gen_random_uuid();
  v_campaign uuid;
  v_count    int;
  v_balance  int;
  v_res      jsonb;
  v_token    text;
  v_rec      uuid;
  v_appt     uuid := gen_random_uuid();
  v_resend   text := 're_test_123';
BEGIN
  -- ── Datos de partida ──────────────────────────────────────────────
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'duena@grupo.com');
  INSERT INTO public.businesses (id, owner_id, name, slug) VALUES
    (v_biz,  v_owner, 'Salón Centro', 'salon-centro'),
    (v_biz2, v_owner, 'Salón Norte',  'salon-norte');

  -- 5 clientes con email válido, 1 sin email, 1 que no quiere correos,
  -- y 1 duplicado en la otra sucursal (mismo email).
  INSERT INTO public.clients (name, email, business_id, preferencia_email) VALUES
    ('Ana',    'ana@mail.com',    v_biz,  true),
    ('Bruno',  'bruno@mail.com',  v_biz,  true),
    ('Carmen', 'CARMEN@mail.com', v_biz,  true),
    ('Diego',  'diego@mail.com',  v_biz,  true),
    ('Elena',  'elena@mail.com',  v_biz,  true),
    ('Sin correo', NULL,          v_biz,  true),
    ('No quiere', 'nope@mail.com', v_biz, false),
    ('Ana bis',  'ANA@mail.com',  v_biz2, true),   -- mismo email, otra sucursal
    ('Malformado', 'esto-no-es-email', v_biz, true);

  INSERT INTO public.hub_connections (hub_owner_id, business_id, marketing_allowed)
  VALUES (v_owner, v_biz, true), (v_owner, v_biz2, true);

  PERFORM set_config('test.uid', v_owner::text, false);

  -- ── 1. Audiencia: minúsculas, consentimiento, formato ─────────────
  -- Antes esperaba 5, porque Ana —clienta de las dos sucursales— contaba
  -- una sola vez. Ahora cuenta dos, una por salón: no sabemos cuál es el
  -- suyo de verdad, y elegir por ella acertaba la mitad de las veces.
  -- Fuera siguen quedando los sin correo, los que dijeron que no y los
  -- que tienen la dirección mal escrita.
  SELECT count(*) INTO v_count
  FROM hub_resolve_audience(v_owner, ARRAY[v_biz, v_biz2], 'discount', 30);
  RAISE NOTICE '1. Audiencia resuelta: % (esperado 6: Ana ×2, fuera sin-email/opt-out/malformado)', v_count;
  ASSERT v_count = 6, 'La audiencia deberia ser 6';

  -- El contador que ve el usuario debe dar exactamente lo mismo. Si no
  -- coincidiera, se cobraría una cifra y se enviaría otra.
  SELECT get_campaign_recipient_count(ARRAY[v_biz, v_biz2], 'discount', 30) INTO v_count;
  RAISE NOTICE '2. Contador del interfaz: % (debe coincidir con la audiencia)', v_count;
  ASSERT v_count = 6, 'El contador debe coincidir con la audiencia';

  -- ── 2. Saldo ──────────────────────────────────────────────────────
  INSERT INTO public.hub_credit_packs (code, name, credits, price_cents, sort_order)
  VALUES ('test', 'Test', 1000, 1500, 99) ON CONFLICT DO NOTHING;

  SELECT hub_credit_purchase(v_owner, 'test', 'pi_test_1') INTO v_res;
  RAISE NOTICE '3. Compra de pack: %', v_res;
  ASSERT (v_res->>'success')::bool, 'La compra deberia funcionar';

  -- Idempotencia: el mismo PaymentIntent no puede acreditar dos veces.
  SELECT hub_credit_purchase(v_owner, 'test', 'pi_test_1') INTO v_res;
  ASSERT (v_res->>'duplicate')::bool, 'El pago repetido debe detectarse';
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '4. Saldo tras compra duplicada: % (esperado 1000)', v_balance;
  ASSERT v_balance = 1000, 'El saldo no debe duplicarse';

  -- ── 3. Campaña ────────────────────────────────────────────────────
  INSERT INTO public.hub_campaigns (hub_owner_id, template_type, target_business_ids, status)
  VALUES (v_owner, 'discount', ARRAY[v_biz, v_biz2], 'draft')
  RETURNING id INTO v_campaign;

  SELECT hub_materialize_campaign(v_campaign, 1000) INTO v_count;
  RAISE NOTICE '5. Destinatarios encolados: % (esperado 6, los mismos que se contaron)', v_count;
  ASSERT v_count = 6, 'Deberian encolarse 6';

  -- Reintentar no debe duplicar ni permitir re-materializar.
  BEGIN
    PERFORM hub_materialize_campaign(v_campaign, 1000);
    RAISE EXCEPTION 'No deberia poder materializarse dos veces';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%ya fue procesada%' THEN
      RAISE NOTICE '6. Doble materializacion bloqueada correctamente';
    ELSE RAISE;
    END IF;
  END;

  -- ── 4. Consumo de créditos ────────────────────────────────────────
  SELECT hub_consume_credits(v_owner, 5, v_campaign, 'campaign') INTO v_res;
  ASSERT (v_res->>'success')::bool, 'El consumo deberia funcionar';
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '7. Saldo tras consumir 5: % (esperado 995)', v_balance;
  ASSERT v_balance = 995, 'Saldo incorrecto tras consumo';

  -- Saldo insuficiente: debe rechazar sin dejar rastro.
  SELECT hub_consume_credits(v_owner, 999999, NULL, 'campaign') INTO v_res;
  ASSERT NOT (v_res->>'success')::bool, 'Deberia rechazar por saldo insuficiente';
  RAISE NOTICE '8. Saldo insuficiente rechazado: %', v_res->>'error';

  -- ── 5. Worker ─────────────────────────────────────────────────────
  SELECT count(*) INTO v_count FROM hub_claim_recipient_batch(v_campaign, 3);
  RAISE NOTICE '9. Primer tramo reservado: % (esperado 3)', v_count;
  ASSERT v_count = 3, 'El tramo deberia ser 3';

  SELECT count(*) INTO v_count FROM hub_claim_recipient_batch(v_campaign, 100);
  RAISE NOTICE '10. Segundo tramo: % (esperado 3, el resto)', v_count;
  ASSERT v_count = 3, 'Deberian quedar 3';

  SELECT count(*) INTO v_count FROM hub_claim_recipient_batch(v_campaign, 100);
  ASSERT v_count = 0, 'La cola deberia estar vacia';
  RAISE NOTICE '11. Cola agotada, sin reenvios';

  -- Marcar todos como enviados
  FOR v_rec IN SELECT id FROM hub_campaign_recipients WHERE campaign_id = v_campaign LOOP
    PERFORM hub_mark_recipient(v_rec, 'sent', v_resend || v_rec::text, NULL);
  END LOOP;

  -- ── 6. Eventos de Resend ──────────────────────────────────────────
  SELECT id, unsubscribe_token INTO v_rec, v_token
  FROM hub_campaign_recipients WHERE campaign_id = v_campaign ORDER BY email LIMIT 1;

  PERFORM hub_apply_email_event(v_resend || v_rec::text, 'email.delivered');
  PERFORM hub_apply_email_event(v_resend || v_rec::text, 'email.opened');
  SELECT status INTO v_res FROM (SELECT to_jsonb(status) AS status FROM hub_campaign_recipients WHERE id = v_rec) x;
  RAISE NOTICE '12. Tras entregado+abierto el estado es %', v_res;
  ASSERT v_res::text = '"opened"', 'Deberia estar abierto';

  -- Una entrega tardía no debe degradar el estado ya avanzado.
  PERFORM hub_apply_email_event(v_resend || v_rec::text, 'email.delivered');
  SELECT to_jsonb(status) INTO v_res FROM hub_campaign_recipients WHERE id = v_rec;
  ASSERT v_res::text = '"opened"', 'Un evento atrasado no debe retroceder el estado';
  RAISE NOTICE '13. Evento atrasado ignorado correctamente';

  -- Queja de spam: supresion global automatica
  --
  -- Se busca a OTRA PERSONA, no a otra fila. Ahora que quien es cliente de
  -- dos sucursales tiene dos filas, «la siguiente fila» era la segunda de
  -- Ana: la queja y la baja de más abajo recaían sobre la misma persona y
  -- la comprobación 17 dejaba de medir lo que pretende, que es que dos
  -- supresiones distintas excluyan a dos personas distintas.
  SELECT id INTO v_rec FROM hub_campaign_recipients
  WHERE campaign_id = v_campaign
    AND email <> (SELECT email FROM hub_campaign_recipients WHERE id = v_rec)
  ORDER BY email LIMIT 1;
  PERFORM hub_apply_email_event(v_resend || v_rec::text, 'email.complained');
  SELECT count(*) INTO v_count FROM hub_email_suppressions WHERE reason = 'complaint';
  RAISE NOTICE '14. Supresiones por queja: % (esperado 1)', v_count;
  ASSERT v_count = 1, 'La queja deberia crear supresion global';

  -- ── 7. Baja por token ─────────────────────────────────────────────
  SELECT hub_unsubscribe_by_token(v_token) INTO v_res;
  RAISE NOTICE '15. Baja: %', v_res;
  ASSERT (v_res->>'success')::bool, 'La baja deberia funcionar';

  SELECT hub_unsubscribe_by_token('token-inventado') INTO v_res;
  ASSERT NOT (v_res->>'success')::bool, 'Un token falso debe rechazarse';
  RAISE NOTICE '16. Token invalido rechazado';

  -- ── 8. La supresión excluye de la siguiente campaña ───────────────
  SELECT count(*) INTO v_count
  FROM hub_resolve_audience(v_owner, ARRAY[v_biz, v_biz2], 'discount', 30);
  RAISE NOTICE '17. Audiencia tras baja + queja: % (esperado 3 de los 6)', v_count;
  -- Ana se va con sus dos filas —una baja calla todas sus sucursales— y el
  -- de la queja con la suya: tres filas menos de seis.
  ASSERT v_count = 3, 'Las supresiones deben excluir a Ana (x2) y al de la queja';

  -- ── 9. Atribución y retorno ───────────────────────────────────────
  SELECT unsubscribe_token INTO v_token
  FROM hub_campaign_recipients WHERE campaign_id = v_campaign AND status = 'sent' LIMIT 1;

  INSERT INTO public.appointments (id, business_id, client_id, status, price, start_time)
  VALUES (v_appt, v_biz, NULL, 'COMPLETED', 45.00, now());

  ASSERT hub_attribute_appointment(v_appt, v_token), 'La atribucion deberia funcionar';
  ASSERT NOT hub_attribute_appointment(v_appt, 'token-falso'), 'Token falso no atribuye';
  RAISE NOTICE '18. Reserva atribuida a la campana';

  PERFORM hub_refresh_campaign_stats(v_campaign);
  SELECT hub_campaign_performance(v_campaign) INTO v_res;
  RAISE NOTICE '19. Retorno: reservas=%, facturado=%, roi=%',
    v_res->>'bookings', v_res->>'revenue', v_res->>'roi';
  ASSERT (v_res->>'bookings')::int = 1, 'Deberia haber 1 reserva atribuida';
  ASSERT (v_res->>'revenue')::numeric = 45.00, 'Deberian ser 45 EUR';

  -- ── 10. Devolución de lo no enviado ───────────────────────────────
  PERFORM hub_refund_credits(v_owner, 2, v_campaign, 'no enviados');
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '20. Saldo tras devolucion de 2: % (esperado 997)', v_balance;
  ASSERT v_balance = 997, 'La devolucion no cuadra';

  -- ── 11. Acceso denegado a negocio ajeno ───────────────────────────
  BEGIN
    PERFORM hub_resolve_audience(gen_random_uuid(), ARRAY[v_biz], 'discount', 30);
    RAISE EXCEPTION 'Deberia haber denegado el acceso';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%Acceso denegado%' THEN
      RAISE NOTICE '21. Acceso a negocio ajeno denegado correctamente';
    ELSE RAISE;
    END IF;
  END;

  -- ── 12. La bolsa mensual del plan no se duplica ───────────────────
  INSERT INTO public.hub_subscriptions (hub_owner_id, monthly_credits, status)
  VALUES (v_owner, 500, 'active');
  PERFORM hub_grant_monthly_credits();
  PERFORM hub_grant_monthly_credits();   -- segunda vez el mismo mes
  SELECT hub_credit_balance(v_owner) INTO v_balance;
  RAISE NOTICE '22. Saldo con bolsa mensual: % (esperado 1497, no 1997)', v_balance;
  ASSERT v_balance = 1497, 'La bolsa mensual se ha duplicado';

  -- El consumo debe gastar primero lo que caduca antes (la bolsa del plan).
  PERFORM hub_consume_credits(v_owner, 100, NULL, 'campaign');
  SELECT COALESCE(SUM(credits_remaining),0) INTO v_count
  FROM hub_credit_lots WHERE hub_owner_id = v_owner AND source = 'plan';
  RAISE NOTICE '23. Bolsa del plan tras gastar 100: % (esperado 400)', v_count;
  ASSERT v_count = 400, 'Deberia consumirse primero la bolsa del plan';

  RAISE NOTICE '';
  RAISE NOTICE '=== TODAS LAS COMPROBACIONES PASAN ===';
END
$test$;
