-- ============================================================
-- TRIMM Hub — El presupuesto es lo que se cobra
--
-- La primera versión de hub_quote_campaign cobraba lo menor entre el
-- presupuesto y la audiencia: si pedías 5 € y solo tenías 10 clientes, se
-- cobraban 0,20 €. Sobre el papel es lo más justo. En la práctica no
-- funciona, por dos motivos:
--
--   · Stripe no cobra por debajo de 0,50 €, y nuestro mínimo son 5 € porque
--     por debajo la comisión se come la venta. Un negocio recién conectado,
--     con pocos clientes, se encontraba con el botón muerto y sin más
--     explicación que un importe imposible de cobrar. Justo el negocio al
--     que más falta le hace la campaña.
--
--   · Los envíos no se evaporan. Si el presupuesto da para 250 y solo hay
--     10 destinatarios, los 240 restantes se quedan en el saldo y sirven
--     para la campaña siguiente. Cobrar los 5 € no es quedarse con dinero
--     por correos que no existen: es venderlos por adelantado, que es
--     exactamente lo que hace un pack.
--
-- Así que ahora se cobra el presupuesto, se acredita todo lo que compra, y
-- salen los que haya. La pantalla lo dice con esas palabras: cuántos van
-- ahora y cuántos quedan para después. Lo que no se puede hacer es cobrar
-- y no decirlo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_quote_campaign(
  p_business_ids  UUID[],
  p_template_type TEXT,
  p_days_inactive INT,
  p_budget_cents  INT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner     UUID := auth.uid();
  v_rate      NUMERIC;
  v_min       INT;
  v_max       INT;
  v_audiencia INT;
  v_comprados INT;
  v_envios    INT;
  v_importe   INT;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Sin sesión';
  END IF;

  SELECT direct_rate_cents, min_budget_cents, max_budget_cents
    INTO v_rate, v_min, v_max
  FROM hub_pricing WHERE id;

  -- hub_resolve_audience comprueba que las sucursales sean suyas y hayan
  -- autorizado el marketing, así que la comprobación de acceso está ahí.
  SELECT count(*) INTO v_audiencia
  FROM hub_resolve_audience(v_owner, p_business_ids,
                            COALESCE(p_template_type, 'discount'),
                            COALESCE(p_days_inactive, 30));

  -- Cuántos envíos compra el presupuesto, hacia abajo: no se manda medio
  -- correo, y redondear hacia arriba sería regalar envíos.
  v_comprados := FLOOR(LEAST(GREATEST(p_budget_cents, 0), v_max) / v_rate);

  -- De esos, los que salen ahora: no hay a quién mandar más.
  v_envios := LEAST(v_comprados, v_audiencia);

  -- Y se cobra lo comprado, no lo enviado. La diferencia se queda en el
  -- saldo, que es de quien paga.
  v_importe := CEIL(v_comprados * v_rate);

  RETURN jsonb_build_object(
    'audience',         v_audiencia,
    'rate_cents',       v_rate,
    'min_budget_cents', v_min,
    'max_budget_cents', v_max,
    'budget_cents',     p_budget_cents,
    -- Envíos que se acreditan: es lo que se paga.
    'credits',          v_comprados,
    -- Envíos que salen en esta campaña.
    'emails',           v_envios,
    -- Los que quedan en el saldo para la próxima. La pantalla tiene que
    -- decirlo: cobrar por envíos que no salen hoy sin avisar sería
    -- indistinguible de cobrar de más.
    'leftover',         v_comprados - v_envios,
    'amount_cents',     v_importe,
    'capped_by_audience', v_comprados > v_audiencia,
    'below_minimum',    p_budget_cents < v_min,
    -- Se mantiene por compatibilidad con la primera versión.
    'affordable',       v_comprados
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hub_quote_campaign(UUID[], TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hub_quote_campaign(UUID[], TEXT, INT, INT) TO authenticated;

COMMENT ON FUNCTION public.hub_quote_campaign(UUID[], TEXT, INT, INT) IS
  'Presupuesto → envíos. Se cobra lo que compra el presupuesto; salen los '
  'que haya destinatarios y el resto queda en el saldo.';
