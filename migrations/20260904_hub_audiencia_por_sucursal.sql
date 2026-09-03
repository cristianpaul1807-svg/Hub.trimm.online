-- ============================================================
-- TRIMM Hub — Un correo por sucursal, no uno por persona
--
-- Hasta ahora la audiencia se deduplicaba por dirección de correo: quien
-- era cliente de dos sucursales del grupo recibía un solo mensaje, y la
-- sucursal que lo firmaba se elegía de forma estable pero arbitraria — la
-- de identificador más bajo.
--
-- Estable no es lo mismo que acertado. Esa persona recibía «eres cliente
-- de Vital Touch» con el enlace de Vital Touch aunque llevara tres años
-- yendo a Chris barber. Y no tenemos forma de saber cuál es su preferida:
-- las dos fichas son igual de reales.
--
-- Así que se le escribe desde cada una. Dos sucursales, dos correos, cada
-- uno con su nombre, su enlace y su código. Que elija ella, que es la
-- única que sabe.
--
-- ── Lo que cuesta ───────────────────────────────────────────────────
--
-- Dos envíos en vez de uno, y por tanto dos créditos. Es correcto: son dos
-- correos que salen. Y la cifra que se enseña antes de pagar sale de esta
-- misma función, así que sube sola y sigue cuadrando con lo que se cobra.
--
-- ── Lo que NO cambia: las bajas ─────────────────────────────────────
--
-- Darse de baja en una sucursal sigue bloqueando el correo en todas las
-- del grupo dentro de esa campaña. Aquí no se sigue el mismo razonamiento
-- que arriba a propósito: quien pulsa «darse de baja» quiere dejar de
-- recibir esto, no matizar de qué sucursal. Equivocarse hacia el silencio
-- cuesta un envío; equivocarse hacia el ruido cuesta una queja de spam, y
-- las quejas se pagan con la reputación del dominio, que es lo que hace
-- que lleguen los recordatorios de cita.
-- ============================================================

-- ── 1. La audiencia, por sucursal ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.hub_resolve_audience(
  p_hub_owner_id  UUID,
  p_business_ids  UUID[],
  p_template_type TEXT DEFAULT 'discount',
  p_days_inactive INT  DEFAULT 30
)
RETURNS TABLE (client_id UUID, business_id UUID, email TEXT, client_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Los parámetros de salida se llaman igual que columnas de la consulta; esta
-- directiva le dice a PL/pgSQL que ante la duda gane la columna.
#variable_conflict use_column
DECLARE
  v_cutoff TIMESTAMPTZ := now() - (p_days_inactive || ' days')::INTERVAL;
BEGIN
  -- Con sesión iniciada sólo se puede preguntar por la audiencia propia.
  -- Sin sesión (clave de servicio, o la baja desde el enlace de un correo)
  -- se confía en el llamante, que ya es código nuestro.
  IF auth.uid() IS NOT NULL AND p_hub_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  -- El Hub sólo puede dirigirse a negocios vinculados que además hayan
  -- autorizado el uso comercial de su base de clientes.
  IF EXISTS (
    SELECT 1 FROM unnest(p_business_ids) AS bid
    WHERE bid NOT IN (
      SELECT hc.business_id
      FROM hub_connections hc
      WHERE hc.hub_owner_id = p_hub_owner_id
        AND hc.marketing_allowed = true
    )
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: negocio no vinculado o sin permiso de marketing';
  END IF;

  RETURN QUERY
  WITH
  -- Un cliente pertenece a un negocio por cualquiera de las dos vías que
  -- existen en el esquema de Trimm: la columna directa o la tabla puente.
  membership AS (
    SELECT c.id AS client_id, c.business_id, c.email, c.name, c.preferencia_email
    FROM clients c
    WHERE c.business_id = ANY(p_business_ids)
    UNION
    SELECT c.id, bc.business_id, c.email, c.name, c.preferencia_email
    FROM business_clients bc
    JOIN clients c ON c.id = bc.client_id
    WHERE bc.business_id = ANY(p_business_ids)
  ),
  -- Filtro específico de cada plantilla.
  targeted AS (
    SELECT m.*
    FROM membership m
    WHERE
      CASE
        WHEN p_template_type = 'reengagement' THEN EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.client_id = m.client_id
            AND a.business_id = ANY(p_business_ids)
            AND a.status IN ('CANCELLED', 'CANCELLED_CLIENT', 'CANCELED')
            AND a.start_time >= v_cutoff
        )
        ELSE true
      END
  ),
  -- Higiene: email presente, con forma válida, y consentimiento vigente.
  eligible AS (
    SELECT
      t.client_id,
      t.business_id,
      lower(btrim(t.email)) AS email,
      t.name
    FROM targeted t
    WHERE t.email IS NOT NULL
      AND btrim(t.email) <> ''
      AND lower(btrim(t.email)) ~ '^[^@\s]+@[^@\s.]+\.[^@\s]+$'
      AND COALESCE(t.preferencia_email, true) = true
  )
  -- Una fila por dirección Y sucursal. Quien es cliente de dos recibe dos
  -- correos, uno de cada salón: no sabemos cuál es el suyo de verdad, y
  -- elegir por él era acertar la mitad de las veces.
  --
  -- Dentro de una misma sucursal sí se deduplica: dos fichas con el mismo
  -- correo en el mismo salón son la misma persona apuntada dos veces, y ahí
  -- el segundo correo no aporta nada, solo molesta.
  --
  -- La supresión se comprueba contra CUALQUIER sucursal a la que pertenezca
  -- ese email dentro de la campaña. Quien pulsa «darse de baja» quiere
  -- dejar de recibir esto, no matizar de qué salón.
  SELECT DISTINCT ON (e.email, e.business_id)
    e.client_id,
    e.business_id,
    e.email,
    e.name
  FROM eligible e
  WHERE NOT EXISTS (
    SELECT 1
    FROM hub_email_suppressions s
    WHERE s.email = e.email
      AND (
        s.business_id IS NULL                                   -- rebote o queja: global
        OR s.business_id = ANY(p_business_ids)                  -- baja en cualquiera de las sucursales
      )
  )
  ORDER BY e.email, e.business_id, e.client_id;
END;
$$;

-- ── 2. La unicidad, también por sucursal ────────────────────────────
-- El índice anterior era (campaña, correo), así que aunque la audiencia
-- devolviera dos filas la segunda se caía en el ON CONFLICT y el cambio de
-- arriba no habría servido de nada.
ALTER TABLE public.hub_campaign_recipients
  DROP CONSTRAINT IF EXISTS hub_campaign_recipients_campaign_id_email_key;

ALTER TABLE public.hub_campaign_recipients
  DROP CONSTRAINT IF EXISTS hub_recipients_unicos_por_sucursal;
ALTER TABLE public.hub_campaign_recipients
  ADD CONSTRAINT hub_recipients_unicos_por_sucursal
  UNIQUE (campaign_id, email, business_id);

-- ── 3. Y la materialización ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hub_materialize_campaign(
  p_campaign_id    UUID,
  p_max_recipients INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign hub_campaigns%ROWTYPE;
  v_inserted INT;
BEGIN
  SELECT * INTO v_campaign
  FROM hub_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaña no encontrada';
  END IF;

  IF v_campaign.status NOT IN ('draft', 'paid') THEN
    RAISE EXCEPTION 'La campaña ya fue procesada (estado: %)', v_campaign.status;
  END IF;

  INSERT INTO hub_campaign_recipients (campaign_id, client_id, business_id, email, client_name)
  SELECT p_campaign_id, a.client_id, a.business_id, a.email, a.client_name
  FROM (
    SELECT *
    FROM hub_resolve_audience(
           v_campaign.hub_owner_id,
           v_campaign.target_business_ids,
           v_campaign.template_type,
           30
         )
    LIMIT p_max_recipients
  ) a
  ON CONFLICT (campaign_id, email, business_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE hub_campaigns
  SET status           = 'queued',
      queued_at        = now(),
      recipients_count = v_inserted
  WHERE id = p_campaign_id;

  RETURN v_inserted;
END;
$$;

COMMENT ON CONSTRAINT hub_recipients_unicos_por_sucursal ON public.hub_campaign_recipients IS
  'Una persona puede recibir un correo por cada sucursal del grupo de la '
  'que es cliente, pero solo uno de cada.';
