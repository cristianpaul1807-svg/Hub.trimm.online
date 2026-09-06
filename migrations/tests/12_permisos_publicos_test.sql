-- Qué puede llamar alguien sin sesión.
--
-- Nació de un fallo real: la página de baja llevaba tiempo respondiendo
-- «permission denied» porque hub_unsubscribe_by_token había perdido el
-- permiso del rol anónimo en producción. Nadie se enteró porque la baja
-- automática de Gmail va por otro camino, con la clave de servicio.
--
-- Esta prueba fija la superficie pública: lo que tiene que poder llamarse
-- desde un correo, y lo que no puede llamarse nunca sin sesión.
\set ON_ERROR_STOP on
\pset pager off

DO $test$
DECLARE
  v_falla int := 0;
  v_nombre text;
  v_puede boolean;
  -- Se abren desde un correo o desde la pantalla de reserva de Trimm, donde
  -- el cliente final no ha iniciado sesión en ningún sitio.
  v_publicas text[] := ARRAY[
    'public.hub_unsubscribe_by_token(text)',
    'public.hub_validate_code(text,uuid,uuid)',
    'public.hub_redeem_code(text,uuid,uuid,uuid,int)',
    'public.hub_attribute_appointment(uuid,text)'
  ];
  -- Estas leen dinero y clientes de un grupo: exigen sesión.
  v_privadas text[] := ARRAY[
    'public.get_hub_metrics(uuid[],timestamptz,timestamptz)',
    'public.get_hub_kpis(uuid[],timestamptz,timestamptz)',
    'public.hub_quote_campaign(uuid[],text,int,int)',
    'public.hub_credit_summary()',
    'public.claim_hub_token(text)'
  ];
BEGIN
  FOREACH v_nombre IN ARRAY v_publicas LOOP
    v_puede := has_function_privilege('anon', v_nombre, 'EXECUTE');
    RAISE NOTICE '  anon → % : %', v_nombre, CASE WHEN v_puede THEN 'sí' ELSE 'NO' END;
    IF NOT v_puede THEN v_falla := v_falla + 1; END IF;
  END LOOP;

  FOREACH v_nombre IN ARRAY v_privadas LOOP
    v_puede := has_function_privilege('anon', v_nombre, 'EXECUTE');
    RAISE NOTICE '  anon ✗ % : %', v_nombre, CASE WHEN v_puede THEN 'PUEDE (mal)' ELSE 'no' END;
    IF v_puede THEN v_falla := v_falla + 1; END IF;
  END LOOP;

  ASSERT v_falla = 0, v_falla || ' funciones con el permiso equivocado para el rol anónimo';
  RAISE NOTICE '✓ Superficie pública: % comprobaciones correctas',
    array_length(v_publicas,1) + array_length(v_privadas,1);
END
$test$;
