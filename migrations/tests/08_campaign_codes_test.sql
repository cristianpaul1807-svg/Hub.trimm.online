-- Códigos de campaña: validar, canjear, topes y accesos.
\set ON_ERROR_STOP on
\pset pager off

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_biz   uuid := gen_random_uuid();
  v_otro  uuid := gen_random_uuid();
  v_camp  uuid;
  v_cli1  uuid := gen_random_uuid();
  v_cli2  uuid := gen_random_uuid();
  v_cita1 uuid := gen_random_uuid();
  v_cita2 uuid := gen_random_uuid();
  v_cita3 uuid := gen_random_uuid();
  r jsonb;
  v_code text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'codigos@grupo.com');
  INSERT INTO public.businesses (id, owner_id, name, slug)
    VALUES (v_biz,  v_owner, 'Centro', 'centro-cod'),
           (v_otro, v_owner, 'Otro',   'otro-cod');

  INSERT INTO public.hub_campaigns (hub_owner_id, template_type, discount_value,
                                    target_business_ids, status)
  VALUES (v_owner, 'discount', 20, ARRAY[v_biz], 'sending')
  RETURNING id INTO v_camp;

  -- ── 1. Se crea a partir de la campaña ─────────────────────────────
  r := hub_create_campaign_code(v_camp, 3, 30);
  v_code := r->>'code';
  RAISE NOTICE '1. Código creado: % (tipo %, valor %)',
    v_code, r->>'kind', r->>'value';
  ASSERT (r->>'success')::boolean, 'Deberia crearse';
  ASSERT r->>'kind' = 'percent', 'Una campana de descuento descuenta un porcentaje';
  ASSERT (r->>'value')::numeric = 20, 'Y el porcentaje es el de la campana';
  ASSERT v_code LIKE 'DTO20-%', 'El prefijo deberia decir de que es';

  -- La parte aleatoria, sin caracteres ambiguos: quien la dicta por
  -- teléfono no debe dudar entre O y cero. El prefijo sí puede llevarlos
  -- —DTO20 se entiende— porque es una palabra, no una tirada de dados: si
  -- se oye mal, el contexto la reconstruye; la cola no.
  ASSERT split_part(v_code, '-', 2) !~ '[IO01]',
    'La parte aleatoria no debe llevar I, O, 0 ni 1';
  ASSERT length(split_part(v_code, '-', 2)) = 5, 'Cinco caracteres de cola';

  -- ── 2. Llamarla dos veces no crea dos códigos ─────────────────────
  r := hub_create_campaign_code(v_camp, 3, 30);
  RAISE NOTICE '2. Segunda llamada: existing=%, mismo código=%',
    r->>'existing', (r->>'code' = v_code);
  ASSERT (r->>'existing')::boolean, 'Deberia devolver el que ya hay';
  ASSERT r->>'code' = v_code, 'Y ser el mismo';
  ASSERT (SELECT count(*) FROM hub_campaign_codes WHERE campaign_id = v_camp) = 1,
    'Una campana, un codigo';

  -- ── 3. Vale en su sucursal ────────────────────────────────────────
  r := hub_validate_code(v_code, v_biz, v_cli1);
  RAISE NOTICE '3. En su sucursal: valid=%, descuenta % %%', r->>'valid', r->>'value';
  ASSERT (r->>'valid')::boolean, 'Deberia valer';
  ASSERT (r->>'value')::numeric = 20, 'Y decir cuanto descuenta';

  -- ── 4. Y no en otra ───────────────────────────────────────────────
  r := hub_validate_code(v_code, v_otro, v_cli1);
  RAISE NOTICE '4. En otra sucursal: valid=%, motivo=%', r->>'valid', r->>'reason';
  ASSERT NOT (r->>'valid')::boolean, 'No deberia valer en otra sucursal';
  -- Mismo motivo que uno inexistente, para no poder enumerar códigos.
  ASSERT r->>'reason' = 'not_found', 'Debe ser indistinguible de uno que no existe';

  r := hub_validate_code('DTO20-ZZZZZ', v_biz, v_cli1);
  ASSERT r->>'reason' = 'not_found', 'Uno inventado da el mismo motivo';

  -- ── 5. Canjear atribuye la cita a la campaña ──────────────────────
  INSERT INTO public.appointments (id, business_id, client_id,
                                   start_time, end_time, status, price)
  VALUES (v_cita1, v_biz, v_cli1, now(), now() + interval '1 hour', 'COMPLETED', 50);

  r := hub_redeem_code(v_code, v_biz, v_cita1, v_cli1, 1000);
  RAISE NOTICE '5. Canjeado: success=%, descontados % céntimos',
    r->>'success', r->>'discount_cents';
  ASSERT (r->>'success')::boolean, 'Deberia canjear';
  ASSERT (SELECT hub_campaign_id FROM appointments WHERE id = v_cita1) = v_camp,
    'La cita deberia quedar atribuida a la campana';

  -- ── 6. El mismo cliente no repite ─────────────────────────────────
  r := hub_validate_code(v_code, v_biz, v_cli1);
  RAISE NOTICE '6. El mismo cliente otra vez: valid=%, motivo=%',
    r->>'valid', r->>'reason';
  ASSERT NOT (r->>'valid')::boolean, 'No deberia poder repetir';
  ASSERT r->>'reason' = 'already_used', 'Y decir por que';

  -- ── 7. Reintentar la misma cita no cuenta dos canjes ──────────────
  r := hub_redeem_code(v_code, v_biz, v_cita1, v_cli1, 1000);
  RAISE NOTICE '7. Reintento de la misma cita: duplicate=%', r->>'duplicate';
  ASSERT (r->>'success')::boolean, 'Un reintento no es un error';
  ASSERT (r->>'duplicate')::boolean, 'Pero es un duplicado';
  ASSERT (SELECT redemptions FROM hub_campaign_codes WHERE code = v_code) = 1,
    'El contador no deberia subir dos veces';

  -- ── 8. El tope se respeta ─────────────────────────────────────────
  INSERT INTO public.appointments (id, business_id, client_id,
                                   start_time, end_time, status, price)
  VALUES (v_cita2, v_biz, v_cli2, now(), now() + interval '1 hour', 'COMPLETED', 50),
         (v_cita3, v_biz, gen_random_uuid(), now(), now() + interval '2 hours', 'COMPLETED', 50);

  r := hub_redeem_code(v_code, v_biz, v_cita2, v_cli2, 1000);
  ASSERT (r->>'success')::boolean, 'El segundo canje deberia pasar';
  r := hub_redeem_code(v_code, v_biz, v_cita3, gen_random_uuid(), 1000);
  ASSERT (r->>'success')::boolean, 'El tercero tambien';

  UPDATE appointments SET hub_campaign_id = NULL WHERE id = v_cita3;
  r := hub_redeem_code(v_code, v_biz, gen_random_uuid(), gen_random_uuid(), 1000);
  RAISE NOTICE '8. Pasado el tope de 3: success=%, motivo=%',
    r->>'success', r->>'reason';
  ASSERT NOT (r->>'success')::boolean, 'El cuarto NO deberia pasar';
  ASSERT r->>'reason' = 'exhausted', 'Por tope agotado';

  -- ── 9. Caducado ───────────────────────────────────────────────────
  UPDATE hub_campaign_codes
     SET valid_until = now() - interval '1 day', max_redemptions = NULL
   WHERE code = v_code;
  r := hub_validate_code(v_code, v_biz, gen_random_uuid());
  RAISE NOTICE '9. Caducado: valid=%, motivo=%', r->>'valid', r->>'reason';
  ASSERT NOT (r->>'valid')::boolean, 'Un codigo caducado no vale';
  ASSERT r->>'reason' = 'expired', 'Y lo dice';

  -- ── 10. Una campaña que no descuenta lleva código igualmente ──────
  -- Sirve para saber quién vino de ella aunque no toque el precio.
  DECLARE v_c2 uuid; BEGIN
    INSERT INTO public.hub_campaigns (hub_owner_id, template_type,
                                      target_business_ids, status)
    VALUES (v_owner, 'loyalty', ARRAY[v_biz], 'sending')
    RETURNING id INTO v_c2;

    r := hub_create_campaign_code(v_c2, NULL, 60);
    RAISE NOTICE '10. Campaña de fidelización: código % de tipo %',
      r->>'code', r->>'kind';
    ASSERT r->>'kind' = 'none', 'Fidelizacion no toca el precio';
    ASSERT (r->>'code') LIKE 'PUNTOS-%', 'Pero lleva codigo igual';
  END;

  -- ── 11. El porcentaje no puede pasar de 100 ───────────────────────
  BEGIN
    UPDATE hub_campaign_codes SET value = 150 WHERE code = v_code;
    RAISE EXCEPTION 'FUGA: se aceptó un descuento del 150%%';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '11. Un descuento del 150%% rechazado por la base de datos';
  END;

  RAISE NOTICE '';
  RAISE NOTICE 'Códigos de campaña verificados.';
END
$test$;
