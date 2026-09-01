-- ============================================================
-- TRIMM Hub — Arreglar las métricas de personal
--
-- La función desplegada en producción filtraba por `s.is_active`, pero esa
-- columna no existe: en la tabla `staff` se llama `active`. Resultado: la
-- función lanzaba error en CADA llamada, el frontend se tragaba el error y
-- la pantalla de Personal mostraba «Sin datos para este periodo» siempre,
-- con cualquier periodo y cualquier sucursal.
--
-- No era falta de datos. El negocio de prueba tiene 2 empleados activos,
-- 29 citas y 6 completadas dentro del último año.
--
-- El fichero de la migración original (20260628_trimm_hub.sql) ya decía
-- `s.active`: lo que se había desviado era producción, no el repositorio.
-- Esta migración deja las dos iguales.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_hub_staff_metrics(
    p_business_ids UUID[],
    p_from TIMESTAMP WITH TIME ZONE,
    p_to TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    staff_id UUID,
    staff_name TEXT,
    business_id UUID,
    business_name TEXT,
    total_revenue NUMERIC,
    total_appointments BIGINT,
    avg_ticket NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verificar acceso
    IF EXISTS (
        SELECT 1 FROM unnest(p_business_ids) AS bid
        WHERE bid NOT IN (
            SELECT hc.business_id FROM hub_connections hc WHERE hc.hub_owner_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    RETURN QUERY
    SELECT
        s.id AS staff_id,
        s.name AS staff_name,
        b.id AS business_id,
        b.name AS business_name,
        COALESCE(SUM(a.price) FILTER (WHERE a.status = 'COMPLETED'), 0) AS total_revenue,
        COUNT(a.id) FILTER (WHERE a.status = 'COMPLETED') AS total_appointments,
        COALESCE(AVG(a.price) FILTER (WHERE a.status = 'COMPLETED' AND a.price > 0), 0) AS avg_ticket
    FROM staff s
    JOIN businesses b ON b.id = s.business_id
    LEFT JOIN appointments a ON a.staff_id = s.id
        AND a.start_time BETWEEN p_from AND p_to
    WHERE s.business_id = ANY(p_business_ids)
      AND s.active = true          -- era s.is_active, que no existe
    GROUP BY s.id, s.name, b.id, b.name
    ORDER BY total_revenue DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_hub_staff_metrics(UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hub_staff_metrics(UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;
