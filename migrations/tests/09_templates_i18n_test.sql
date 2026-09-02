-- Catálogo de plantillas por idioma y destino del botón.
\set ON_ERROR_STOP on
\pset pager off

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  n int;
  v_txt text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'idiomas@grupo.com');
  PERFORM set_config('test.uid', v_owner::text, false);

  -- ── 1. Las seis existen en los cinco idiomas ──────────────────────
  SELECT count(*) INTO n FROM hub_email_templates
   WHERE hub_owner_id IS NULL AND is_system;
  RAISE NOTICE '1. Plantillas del sistema en total: % (6 × 5 idiomas)', n;
  ASSERT n = 30, 'Deberian ser 30: seis plantillas por cinco idiomas';

  FOR v_txt IN SELECT unnest(ARRAY['es','en','fr','it','pt']) LOOP
    SELECT count(*) INTO n FROM hub_email_templates
     WHERE hub_owner_id IS NULL AND lang = v_txt;
    ASSERT n = 6, format('Faltan plantillas en %s: hay %s', v_txt, n);
  END LOOP;
  RAISE NOTICE '2. Cada idioma tiene sus seis';

  -- ── 3. El catálogo llega en el idioma pedido ──────────────────────
  SELECT count(*) INTO n FROM hub_templates_for('it');
  RAISE NOTICE '3. Catálogo en italiano: % plantillas', n;
  ASSERT n = 6, 'Deberia devolver seis, una por codigo';

  SELECT name INTO v_txt FROM hub_templates_for('it') WHERE code = 'gracias';
  RAISE NOTICE '4. "gracias" en italiano: "%"', v_txt;
  ASSERT v_txt = 'Grazie della visita', 'Deberia venir en italiano';

  SELECT name INTO v_txt FROM hub_templates_for('fr') WHERE code = 'descuento';
  RAISE NOTICE '5. "descuento" en francés: "%"', v_txt;
  ASSERT v_txt = 'Réduction', 'Deberia venir en frances';

  -- ── 6. Sin idioma, español ────────────────────────────────────────
  SELECT name INTO v_txt FROM hub_templates_for(NULL) WHERE code = 'gracias';
  RAISE NOTICE '6. Sin idioma: "%"', v_txt;
  ASSERT v_txt = 'Gracias por tu visita', 'Sin idioma deberia caer al espanol';

  -- ── 7. Un idioma que no tenemos cae al español, no se queda vacío ──
  SELECT count(*) INTO n FROM hub_templates_for('de');
  RAISE NOTICE '7. En alemán (no lo tenemos): % plantillas', n;
  ASSERT n = 6, 'Un idioma desconocido no puede dejar el catalogo vacio';

  -- ── 8. Y si una plantilla solo existe en español, se ve igual ─────
  -- Es el caso de mañana: se añade una séptima y se traduce después.
  INSERT INTO hub_email_templates
    (hub_owner_id, code, lang, name, layout, subject, body, is_system)
  VALUES (NULL, 'septima', 'es', 'Solo en español', 'plain',
          'Asunto', 'Cuerpo', true);

  SELECT count(*) INTO n FROM hub_templates_for('it');
  RAISE NOTICE '8. Tras añadir una solo en español, en italiano hay %', n;
  ASSERT n = 7, 'La nueva debe verse aunque no este traducida';

  SELECT name INTO v_txt FROM hub_templates_for('it') WHERE code = 'septima';
  ASSERT v_txt = 'Solo en español', 'Y verse en espanol, que es lo que hay';

  -- ── 9. Las propias del usuario van siempre ────────────────────────
  INSERT INTO hub_email_templates
    (hub_owner_id, code, lang, name, layout, subject, body, is_system)
  VALUES (v_owner, 'mia', 'es', 'La mía', 'plain', 'Asunto', 'Cuerpo', false);

  SELECT count(*) INTO n FROM hub_templates_for('it');
  RAISE NOTICE '9. Con una plantilla propia: % (7 del sistema + la mía)', n;
  ASSERT n = 8, 'Las propias van siempre, sea cual sea el idioma';

  -- ── 10. Las de otro dueño, nunca ──────────────────────────────────
  DECLARE v_otro uuid := gen_random_uuid(); BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_otro, 'otro@grupo.com');
    INSERT INTO hub_email_templates
      (hub_owner_id, code, lang, name, layout, subject, body, is_system)
    VALUES (v_otro, 'ajena', 'es', 'La ajena', 'plain', 'Asunto', 'Cuerpo', false);

    SELECT count(*) INTO n FROM hub_templates_for('es')
     WHERE code = 'ajena';
    RAISE NOTICE '10. Plantillas de otro grupo visibles: %', n;
    ASSERT n = 0, 'FUGA: se ve la plantilla de otro grupo';
  END;

  -- ── 11. El botón admite destino propio ────────────────────────────
  UPDATE hub_email_templates SET cta_url = 'https://reservas.ejemplo.com'
   WHERE hub_owner_id = v_owner AND code = 'mia';
  SELECT cta_url INTO v_txt FROM hub_email_templates
   WHERE hub_owner_id = v_owner AND code = 'mia';
  RAISE NOTICE '11. Destino del botón: %', v_txt;
  ASSERT v_txt = 'https://reservas.ejemplo.com', 'Deberia guardarse';

  -- ── 12. Y el enlace llega hasta el worker ─────────────────────────
  -- hub_render_context nombra las columnas una a una, así que una columna
  -- nueva se guarda en la pantalla y desaparece por el camino si a nadie
  -- se le ocurre añadirla también aquí. Esta comprobación existe para que
  -- ese despiste falle en las pruebas y no en el buzón de un cliente.
  DECLARE
    v_camp uuid;
    v_tpl  uuid;
    r jsonb;
  BEGIN
    SELECT id INTO v_tpl FROM hub_email_templates
     WHERE hub_owner_id = v_owner AND code = 'mia';

    INSERT INTO public.businesses (id, owner_id, name, slug)
      VALUES (gen_random_uuid(), v_owner, 'Centro', 'centro-i18n');

    INSERT INTO public.hub_campaigns (hub_owner_id, template_type, template_id,
                                      target_business_ids, status)
    VALUES (v_owner, 'discount', v_tpl, ARRAY[]::uuid[], 'draft')
    RETURNING id INTO v_camp;

    r := hub_render_context(v_camp);
    RAISE NOTICE '12. Lo que recibe el worker lleva cta_url: %',
      r->'template'->>'cta_url';
    ASSERT r->'template'->>'cta_url' = 'https://reservas.ejemplo.com',
      'El enlace del boton debe llegar al worker';
  END;

  RAISE NOTICE '';
  RAISE NOTICE 'Catálogo por idioma verificado.';
END
$test$;
