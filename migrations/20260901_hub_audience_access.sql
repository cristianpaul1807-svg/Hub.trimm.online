-- ============================================================
-- TRIMM Hub — Cerrar el acceso a la audiencia
--
-- hub_resolve_audience recibe el id del propietario como parámetro y
-- comprueba que las sucursales pedidas le pertenecen y han autorizado el
-- uso comercial. Lo que no comprobaba es que quien llama SEA ese
-- propietario.
--
-- Y seguía siendo invocable por el rol `authenticated`: se revocó de
-- PUBLIC y de anon, pero no de authenticated, que lo conserva por las
-- concesiones por defecto. Es decir: cualquier usuario del Hub con sesión
-- podía pedir la audiencia de otro grupo pasando su id de propietario y el
-- de una de sus sucursales, y recibir de vuelta los nombres y correos de
-- sus clientes. Es el dato más sensible de todo el sistema.
--
-- Que los identificadores sean UUID no es un control de acceso; sólo hace
-- el ataque más incómodo.
--
-- Lo mismo, con menos alcance, en hub_refresh_campaign_stats: cualquiera
-- con sesión podía leer las métricas de la campaña de otro conociendo su
-- identificador.
--
-- Dos capas, porque una sola se pierde con el tiempo:
--
--   1. Revocar el permiso. Ninguna de las dos necesita que la llame el
--      navegador: sus llamantes legítimos son funciones SECURITY DEFINER
--      (get_campaign_recipient_count, hub_materialize_campaign,
--      hub_apply_email_event, hub_unsubscribe_by_token) que se ejecutan
--      con los privilegios de su propietario, más el worker con la clave
--      de servicio. Revocar no rompe ninguno de esos caminos.
--
--   2. Comprobar dentro. Si alguien vuelve a conceder el permiso dentro de
--      un año, la función sigue negándose.
--
-- El cuerpo de la función es el mismo de 20260820_hub_campaign_engine.sql,
-- copiado literalmente: aquí sólo se añade la comprobación de acceso.
-- ============================================================

REVOKE ALL ON FUNCTION public.hub_refresh_campaign_stats(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hub_resolve_audience(
  p_hub_owner_id  UUID,
  p_business_ids  UUID[],
  p_template_type TEXT DEFAULT 'discount',
  p_days_inactive INT  DEFAULT 30
)
RETURNS TABLE (
  client_id   UUID,
  business_id UUID,
  email       TEXT,
  client_name TEXT
)
LANGUAGE plpgsql
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
  -- Deduplica por email: una persona con ficha en dos sucursales recibe un
  -- solo correo. La sucursal que lo firma se elige por business_id y no por
  -- client_id, para que sea siempre la misma entre ejecuciones: si variara,
  -- el correo llegaría firmado por una sucursal distinta cada vez.
  --
  -- La supresión se comprueba contra CUALQUIER sucursal a la que pertenezca
  -- ese email dentro de la campaña, no solo la que acaba firmando. Sin esto,
  -- alguien que se da de baja reaparece en el siguiente envío bajo la otra
  -- sucursal.
  SELECT DISTINCT ON (e.email)
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

-- CREATE OR REPLACE conserva los permisos anteriores, así que se revoca
-- después de redefinirla.
REVOKE ALL ON FUNCTION public.hub_resolve_audience(UUID, UUID[], TEXT, INT)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.hub_resolve_audience(UUID, UUID[], TEXT, INT) IS
  'Única fuente de verdad de la audiencia de una campaña: la usan tanto el '
  'recuento que ve el usuario como el envío, para que no puedan divergir. '
  'No invocable desde el navegador: se llega a ella por '
  'get_campaign_recipient_count o hub_materialize_campaign.';
