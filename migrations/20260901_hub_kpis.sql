-- ============================================================
-- TRIMM Hub — Pantalla de KPIs
--
-- Hasta ahora "Estadísticas" y "KPIs" eran el mismo componente: dos
-- entradas de menú para la misma pantalla. Estadísticas responde «cómo voy
-- ahora». Esta función alimenta la otra mitad, que es la que de verdad
-- necesita quien lleva varias sucursales: «voy mejor o peor que antes, y
-- cuál de mis locales tira del grupo».
--
-- Devuelve cuatro bloques:
--   · current   — el periodo pedido
--   · previous  — el periodo inmediatamente anterior de la misma duración,
--                 para poder comparar sin que el usuario haga cuentas
--   · months    — los últimos 12 meses, para ver la tendencia
--   · branches  — el desglose por sucursal, ordenado por facturación
--
-- De paso se corrige get_hub_metrics: sumaba el precio de TODAS las citas
-- del periodo, incluidas las canceladas y las pendientes de pago, así que
-- la facturación que se mostraba estaba inflada. Cuenta el dinero cobrado,
-- no el que se dejó de cobrar.
-- ============================================================

-- ── Facturación: solo lo realmente completado ───────────────────────
CREATE OR REPLACE FUNCTION public.get_hub_metrics(
    p_business_ids UUID[],
    p_from TIMESTAMP WITH TIME ZONE,
    p_to TIMESTAMP WITH TIME ZONE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF EXISTS (
        SELECT 1 FROM unnest(p_business_ids) AS bid
        WHERE bid NOT IN (
            SELECT business_id FROM hub_connections WHERE hub_owner_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'Acceso denegado a uno o más negocios';
    END IF;

    SELECT jsonb_build_object(
        -- Antes: SUM(a.price) sobre todas las citas, canceladas incluidas.
        'total_revenue', COALESCE(SUM(a.price) FILTER (WHERE a.status = 'COMPLETED'), 0),
        'total_appointments', COUNT(a.id) FILTER (WHERE a.status = 'COMPLETED'),
        'cancelled_appointments', COUNT(a.id) FILTER (WHERE a.status IN ('CANCELLED', 'CANCELLED_CLIENT', 'CANCELED')),
        'new_clients', (
            SELECT COUNT(DISTINCT c.id) FROM clients c
            WHERE c.business_id = ANY(p_business_ids)
              AND c.created_at BETWEEN p_from AND p_to
        ),
        'avg_ticket', COALESCE(AVG(a.price) FILTER (WHERE a.status = 'COMPLETED' AND a.price > 0), 0),
        'active_loyalty_cards', (
            SELECT COUNT(*) FROM loyalty_cards lc WHERE lc.business_id = ANY(p_business_ids)
        ),
        'discounts_applied', (
            SELECT COALESCE(SUM(lt.discount_applied), 0) FROM loyalty_transactions lt
            WHERE lt.business_id = ANY(p_business_ids)
              AND lt.created_at BETWEEN p_from AND p_to
              AND lt.transaction_type = 'reward_redeemed'
        )
    ) INTO v_result
    FROM appointments a
    WHERE a.business_id = ANY(p_business_ids)
      AND a.start_time BETWEEN p_from AND p_to;

    RETURN v_result;
END;
$$;

-- ── KPIs con comparación y tendencia ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hub_kpis(
    p_business_ids UUID[],
    p_from TIMESTAMP WITH TIME ZONE,
    p_to   TIMESTAMP WITH TIME ZONE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_span      INTERVAL := p_to - p_from;
    v_prev_from TIMESTAMPTZ := p_from - (p_to - p_from);
    v_current   JSONB;
    v_previous  JSONB;
    v_months    JSONB;
    v_branches  JSONB;
BEGIN
    IF EXISTS (
        SELECT 1 FROM unnest(p_business_ids) AS bid
        WHERE bid NOT IN (
            SELECT business_id FROM hub_connections WHERE hub_owner_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'Acceso denegado a uno o más negocios';
    END IF;

    -- Periodo pedido y periodo anterior de la misma duración.
    -- El filtro va en cada agregado, no en jsonb_build_object: FILTER solo
    -- se admite sobre funciones de agregación.
    SELECT
      jsonb_build_object(
        'revenue',    COALESCE(SUM(price)  FILTER (WHERE es_completada AND tramo = 'actual'), 0),
        'completed',  COUNT(*)             FILTER (WHERE es_completada AND tramo = 'actual'),
        'cancelled',  COUNT(*)             FILTER (WHERE es_cancelada  AND tramo = 'actual'),
        'avg_ticket', COALESCE(AVG(price)  FILTER (WHERE es_completada AND tramo = 'actual' AND price > 0), 0),
        'clients',    COUNT(DISTINCT client_id) FILTER (WHERE es_completada AND tramo = 'actual')
      ),
      jsonb_build_object(
        'revenue',    COALESCE(SUM(price)  FILTER (WHERE es_completada AND tramo = 'anterior'), 0),
        'completed',  COUNT(*)             FILTER (WHERE es_completada AND tramo = 'anterior'),
        'cancelled',  COUNT(*)             FILTER (WHERE es_cancelada  AND tramo = 'anterior'),
        'avg_ticket', COALESCE(AVG(price)  FILTER (WHERE es_completada AND tramo = 'anterior' AND price > 0), 0),
        'clients',    COUNT(DISTINCT client_id) FILTER (WHERE es_completada AND tramo = 'anterior')
      )
    INTO v_current, v_previous
    FROM (
      SELECT
        a.price, a.client_id,
        a.status = 'COMPLETED' AS es_completada,
        a.status IN ('CANCELLED','CANCELLED_CLIENT','CANCELED') AS es_cancelada,
        CASE WHEN a.start_time >= p_from THEN 'actual' ELSE 'anterior' END AS tramo
      FROM appointments a
      WHERE a.business_id = ANY(p_business_ids)
        AND a.start_time >= v_prev_from
        AND a.start_time <= p_to
    ) x;

    -- Clientes que ya habían venido antes del periodo: distingue crecer de
    -- reponer. Es la diferencia entre captar y fidelizar.
    v_current := COALESCE(v_current, '{}'::jsonb) || jsonb_build_object(
      'returning', (
        SELECT COUNT(DISTINCT a.client_id)
        FROM appointments a
        WHERE a.business_id = ANY(p_business_ids)
          AND a.status = 'COMPLETED'
          AND a.start_time BETWEEN p_from AND p_to
          AND a.client_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM appointments p
            WHERE p.client_id = a.client_id
              AND p.business_id = ANY(p_business_ids)
              AND p.status = 'COMPLETED'
              AND p.start_time < p_from
          )
      ),
      'new_clients', (
        SELECT COUNT(*) FROM clients c
        WHERE c.business_id = ANY(p_business_ids)
          AND c.created_at BETWEEN p_from AND p_to
      )
    );

    -- Doce meses de tendencia, con los meses vacíos incluidos: un hueco
    -- dice tanto como un pico, y sin la serie completa el gráfico miente.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'month',     to_char(m.mes, 'YYYY-MM'),
             'revenue',   COALESCE(d.revenue, 0),
             'completed', COALESCE(d.completed, 0)
           ) ORDER BY m.mes), '[]'::jsonb)
    INTO v_months
    FROM generate_series(
           date_trunc('month', p_to) - INTERVAL '11 months',
           date_trunc('month', p_to),
           INTERVAL '1 month') AS m(mes)
    LEFT JOIN (
      SELECT date_trunc('month', a.start_time) AS mes,
             SUM(a.price) FILTER (WHERE a.status = 'COMPLETED') AS revenue,
             COUNT(*)     FILTER (WHERE a.status = 'COMPLETED') AS completed
      FROM appointments a
      WHERE a.business_id = ANY(p_business_ids)
        AND a.start_time >= date_trunc('month', p_to) - INTERVAL '11 months'
      GROUP BY 1
    ) d ON d.mes = m.mes;

    -- Desglose por sucursal: para qué sirve el Hub si no puedes ver cuál
    -- de tus locales tira del grupo y cuál se queda atrás.
    SELECT COALESCE(jsonb_agg(fila ORDER BY (fila->>'revenue')::numeric DESC), '[]'::jsonb)
    INTO v_branches
    FROM (
      SELECT jsonb_build_object(
               'business_id', b.id,
               'name',        btrim(b.name),
               'revenue',     COALESCE(SUM(a.price) FILTER (WHERE a.status = 'COMPLETED'), 0),
               'completed',   COUNT(a.id) FILTER (WHERE a.status = 'COMPLETED'),
               'cancelled',   COUNT(a.id) FILTER (WHERE a.status IN ('CANCELLED','CANCELLED_CLIENT','CANCELED')),
               'avg_ticket',  COALESCE(AVG(a.price) FILTER (WHERE a.status = 'COMPLETED' AND a.price > 0), 0)
             ) AS fila
      FROM businesses b
      LEFT JOIN appointments a ON a.business_id = b.id
        AND a.start_time BETWEEN p_from AND p_to
      WHERE b.id = ANY(p_business_ids)
      GROUP BY b.id, b.name
    ) y;

    RETURN jsonb_build_object(
      'current',  COALESCE(v_current,  '{}'::jsonb),
      'previous', COALESCE(v_previous, '{}'::jsonb),
      'months',   v_months,
      'branches', v_branches,
      'span_days', GREATEST(1, EXTRACT(EPOCH FROM v_span)::int / 86400)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_hub_kpis(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hub_kpis(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.get_hub_kpis(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Alimenta la pantalla de KPIs: periodo actual, periodo anterior equivalente, '
  'doce meses de tendencia y desglose por sucursal.';
