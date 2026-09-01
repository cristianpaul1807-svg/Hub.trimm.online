-- ============================================================
-- TRIMM Hub — Análisis completo del negocio
--
-- Estadísticas dice cómo voy. KPIs dice si voy mejor que antes. Esto dice
-- de qué está hecho el negocio: qué servicios lo sostienen, a qué horas se
-- llena, cuánto sitio libre queda, con cuánta antelación reserva la gente,
-- cómo paga, quién vuelve y quién lleva meses sin aparecer.
--
-- Se mide solo lo que existe de verdad en los datos. Se han dejado fuera, a
-- propósito, las columnas que están vacías al 100% en producción y darían
-- un panel de guiones:
--
--   · deposit_paid / deposit_amount_paid — ningún depósito registrado
--   · reschedule_count                   — ninguna cita reprogramada
--   · cancel_reason                      — ninguna cancelación con motivo
--   · category_id                        — ninguna cita categorizada
--   · reviews                            — tabla vacía
--
-- Cuando esos datos empiecen a llegar, añadir su bloque aquí es directo.
-- ============================================================

-- ── Zona horaria del negocio ────────────────────────────────────────
-- Con una cadena vacía o una zona desconocida, AT TIME ZONE lanza error y
-- se cae toda la consulta. Mejor caer a UTC que dejar la pantalla en blanco.
CREATE OR REPLACE FUNCTION public.zona_de(b public.businesses)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
           (SELECT name FROM pg_timezone_names
             WHERE name = btrim(b.timezone) LIMIT 1),
           'UTC')
$$;

-- ── Duración real de una cita ───────────────────────────────────────
--
-- appointments.duration_minutes existe, no es nula... y vale 0 en las 82
-- citas de producción: la columna nunca se llegó a rellenar. Fiarse de ella
-- daba una ocupación del 0 % para siempre y una duración media de cero en
-- todos los servicios.
--
-- La duración de verdad está en end_time − start_time. Se deja
-- duration_minutes como primera opción por si algún día empieza a
-- rellenarse, y se ignoran los finales anteriores al inicio.
CREATE OR REPLACE FUNCTION public.dur_minutos(a public.appointments)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
           COALESCE(
             NULLIF(a.duration_minutes, 0)::numeric,
             EXTRACT(EPOCH FROM (a.end_time - a.start_time)) / 60,
             0
           ), 0)
$$;

CREATE OR REPLACE FUNCTION public.get_hub_analytics(
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
    v_services      JSONB;
    v_hours         JSONB;
    v_weekdays      JSONB;
    v_occupancy     JSONB;
    v_lead          JSONB;
    v_payments      JSONB;
    v_clients       JSONB;
    v_top_clients   JSONB;
    v_notifications JSONB;
    v_loyalty       JSONB;
    v_staff_count   INT;
    v_open_minutes  NUMERIC;
    v_booked        NUMERIC;
BEGIN
    IF EXISTS (
        SELECT 1 FROM unnest(p_business_ids) AS bid
        WHERE bid NOT IN (
            SELECT business_id FROM hub_connections WHERE hub_owner_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'Acceso denegado a uno o más negocios';
    END IF;

    -- ── Servicios: qué sostiene la caja ──────────────────────────────
    SELECT COALESCE(jsonb_agg(f ORDER BY (f->>'revenue')::numeric DESC), '[]'::jsonb)
    INTO v_services
    FROM (
      SELECT jsonb_build_object(
               'name',         COALESCE(btrim(s.name), 'Sin servicio'),
               'appointments', COUNT(*) FILTER (WHERE a.status = 'COMPLETED'),
               'revenue',      COALESCE(SUM(a.price) FILTER (WHERE a.status = 'COMPLETED'), 0),
               'avg_price',    COALESCE(AVG(a.price) FILTER (WHERE a.status = 'COMPLETED' AND a.price > 0), 0),
               'avg_minutes',  COALESCE(AVG(dur_minutos(a)) FILTER (WHERE a.status = 'COMPLETED'), 0)
             ) AS f
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      WHERE a.business_id = ANY(p_business_ids)
        AND a.start_time BETWEEN p_from AND p_to
      GROUP BY COALESCE(btrim(s.name), 'Sin servicio')
      HAVING COUNT(*) FILTER (WHERE a.status = 'COMPLETED') > 0
    ) x;

    -- ── Franjas horarias: cuándo se llena ────────────────────────────
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'hour', h.hora, 'appointments', COALESCE(d.n, 0), 'revenue', COALESCE(d.rev, 0)
           ) ORDER BY h.hora), '[]'::jsonb)
    INTO v_hours
    FROM generate_series(0, 23) AS h(hora)
    LEFT JOIN (
      -- La hora se calcula en la zona del negocio, no en UTC. Un grupo puede
      -- tener sucursales en Madrid, Roma y La Habana a la vez: en UTC, a la
      -- italiana le saldría que su hora punta son las 6 de la mañana.
      SELECT EXTRACT(HOUR FROM (a.start_time AT TIME ZONE zona_de(b)))::int AS hora,
             COUNT(*) FILTER (WHERE a.status = 'COMPLETED') AS n,
             COALESCE(SUM(a.price) FILTER (WHERE a.status = 'COMPLETED'), 0) AS rev
      FROM appointments a
      JOIN businesses b ON b.id = a.business_id
      WHERE a.business_id = ANY(p_business_ids)
        AND a.start_time BETWEEN p_from AND p_to
      GROUP BY 1
    ) d ON d.hora = h.hora;

    -- ── Días de la semana ────────────────────────────────────────────
    -- Se devuelven los siete siempre: un lunes a cero es información.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'dow', w.dia, 'appointments', COALESCE(d.n, 0),
             'revenue', COALESCE(d.rev, 0), 'cancelled', COALESCE(d.canc, 0)
           ) ORDER BY w.dia), '[]'::jsonb)
    INTO v_weekdays
    FROM generate_series(0, 6) AS w(dia)
    LEFT JOIN (
      -- Misma razón que en las horas: una cita de las 23:30 en Madrid cae
      -- en el día siguiente si se mira en UTC.
      SELECT EXTRACT(DOW FROM (a.start_time AT TIME ZONE zona_de(b)))::int AS dia,
             COUNT(*) FILTER (WHERE a.status = 'COMPLETED') AS n,
             COALESCE(SUM(a.price) FILTER (WHERE a.status = 'COMPLETED'), 0) AS rev,
             COUNT(*) FILTER (WHERE a.status IN ('CANCELLED','CANCELLED_CLIENT','CANCELED')) AS canc
      FROM appointments a
      JOIN businesses b ON b.id = a.business_id
      WHERE a.business_id = ANY(p_business_ids)
        AND a.start_time BETWEEN p_from AND p_to
      GROUP BY 1
    ) d ON d.dia = w.dia;

    -- ── Ocupación ────────────────────────────────────────────────────
    -- Capacidad = minutos de apertura × empleados activos. Es la cuenta
    -- honesta: dos peluqueros en una jornada de ocho horas son dieciséis
    -- horas vendibles, no ocho. Se descuentan los descansos y los días
    -- marcados como cerrados.
    SELECT COUNT(*) INTO v_staff_count
    FROM staff WHERE business_id = ANY(p_business_ids) AND active = true;

    SELECT COALESCE(SUM(minutos), 0) INTO v_open_minutes
    FROM (
      SELECT SUM(
               EXTRACT(EPOCH FROM (wh.close_time - wh.open_time)) / 60
               - COALESCE(EXTRACT(EPOCH FROM (wh.break_end - wh.break_start)) / 60, 0)
             ) AS minutos
      FROM (
        SELECT b.id AS business_id, d::date AS dia
        FROM businesses b
        CROSS JOIN generate_series(p_from::date, p_to::date, INTERVAL '1 day') AS d
        WHERE b.id = ANY(p_business_ids)
      ) dias
      JOIN business_working_hours wh
        ON wh.business_id = dias.business_id
       AND wh.day_of_week = EXTRACT(DOW FROM dias.dia)::int
      WHERE NOT EXISTS (
        SELECT 1 FROM business_closed_days cd
        WHERE cd.business_id = dias.business_id AND cd.closed_date = dias.dia
      )
      GROUP BY dias.business_id, dias.dia
    ) z;

    -- El tiempo ocupado incluye las citas confirmadas todavía por atender:
    -- ese hueco no se puede vender dos veces.
    SELECT COALESCE(SUM(dur_minutos(a)), 0) INTO v_booked
    FROM appointments a
    WHERE a.business_id = ANY(p_business_ids)
      AND a.start_time BETWEEN p_from AND p_to
      AND a.status IN ('COMPLETED', 'CONFIRMED');

    v_occupancy := jsonb_build_object(
      'booked_minutes',    v_booked,
      'capacity_minutes',  v_open_minutes * GREATEST(v_staff_count, 1),
      'active_staff',      v_staff_count,
      'rate', CASE
                WHEN v_open_minutes > 0 AND v_staff_count > 0
                THEN ROUND(100 * v_booked / (v_open_minutes * v_staff_count), 1)
                ELSE NULL   -- sin horario configurado no se inventa un porcentaje
              END
    );

    -- ── Antelación de reserva ────────────────────────────────────────
    -- Cuánto margen hay entre que reservan y que vienen. Marca si se puede
    -- planificar la semana o se vive al día.
    SELECT jsonb_build_object(
             'avg_days', COALESCE(ROUND(AVG(dias_antes)::numeric, 1), 0),
             'buckets', jsonb_build_object(
               'same_day',  COUNT(*) FILTER (WHERE dias_antes < 1),
               'one_two',   COUNT(*) FILTER (WHERE dias_antes >= 1 AND dias_antes < 3),
               'three_week',COUNT(*) FILTER (WHERE dias_antes >= 3 AND dias_antes < 8),
               'over_week', COUNT(*) FILTER (WHERE dias_antes >= 8)
             )
           )
    INTO v_lead
    FROM (
      SELECT GREATEST(EXTRACT(EPOCH FROM (a.start_time - a.created_at)) / 86400, 0) AS dias_antes
      FROM appointments a
      WHERE a.business_id = ANY(p_business_ids)
        AND a.start_time BETWEEN p_from AND p_to
        AND a.created_at IS NOT NULL
        AND a.status IN ('COMPLETED','CONFIRMED')
    ) l;

    -- ── Cómo se paga ─────────────────────────────────────────────────
    SELECT jsonb_build_object(
             'methods', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('method', m, 'appointments', n, 'revenue', rev)
                                ORDER BY rev DESC)
               FROM (
                 SELECT COALESCE(a.payment_method, 'sin_registrar') AS m,
                        COUNT(*) AS n,
                        COALESCE(SUM(a.price), 0) AS rev
                 FROM appointments a
                 WHERE a.business_id = ANY(p_business_ids)
                   AND a.start_time BETWEEN p_from AND p_to
                   AND a.status = 'COMPLETED'
                 GROUP BY 1
               ) mm
             ), '[]'::jsonb),
             'pending_amount', (
               SELECT COALESCE(SUM(a.price), 0)
               FROM appointments a
               WHERE a.business_id = ANY(p_business_ids)
                 AND a.start_time BETWEEN p_from AND p_to
                 AND a.payment_status = 'pending'
             )
           )
    INTO v_payments;

    -- ── Clientes: quién vuelve y quién se ha ido ─────────────────────
    SELECT jsonb_build_object(
             'with_visits',   COUNT(*),
             'one_timers',    COUNT(*) FILTER (WHERE visitas = 1),
             'repeaters',     COUNT(*) FILTER (WHERE visitas > 1),
             'avg_visits',    COALESCE(ROUND(AVG(visitas)::numeric, 1), 0),
             'avg_spend',     COALESCE(ROUND(AVG(gasto)::numeric, 2), 0),
             -- Sin pasar por caja en más de dos meses: la lista natural a
             -- la que dirigir una campaña de recuperación.
             'dormant_60d',   COUNT(*) FILTER (WHERE ultima < p_to - INTERVAL '60 days')
           )
    INTO v_clients
    FROM (
      SELECT a.client_id,
             COUNT(*) AS visitas,
             SUM(a.price) AS gasto,
             MAX(a.start_time) AS ultima
      FROM appointments a
      WHERE a.business_id = ANY(p_business_ids)
        AND a.status = 'COMPLETED'
        AND a.client_id IS NOT NULL
      GROUP BY a.client_id
    ) c;

    SELECT COALESCE(jsonb_agg(f ORDER BY (f->>'spend')::numeric DESC), '[]'::jsonb)
    INTO v_top_clients
    FROM (
      SELECT jsonb_build_object(
               'name',   COALESCE(NULLIF(btrim(cl.name), ''), 'Sin nombre'),
               'visits', COUNT(*),
               'spend',  COALESCE(SUM(a.price), 0),
               'last_visit', MAX(a.start_time)
             ) AS f
      FROM appointments a
      JOIN clients cl ON cl.id = a.client_id
      WHERE a.business_id = ANY(p_business_ids)
        AND a.status = 'COMPLETED'
        AND a.start_time BETWEEN p_from AND p_to
      GROUP BY cl.id, cl.name
      ORDER BY SUM(a.price) DESC NULLS LAST
      LIMIT 10
    ) tc;

    -- ── Avisos: ¿llegan los recordatorios? ───────────────────────────
    -- Un recordatorio que no sale es una ausencia que nadie vio venir.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'type', tipo, 'sent', enviados, 'failed', fallidos
           ) ORDER BY tipo), '[]'::jsonb)
    INTO v_notifications
    FROM (
      SELECT nl.type AS tipo,
             COUNT(*) FILTER (WHERE nl.status = 'sent')   AS enviados,
             COUNT(*) FILTER (WHERE nl.status = 'failed') AS fallidos
      FROM notification_logs nl
      WHERE nl.business_id = ANY(p_business_ids)
        AND nl.sent_at BETWEEN p_from AND p_to
      GROUP BY nl.type
    ) n;

    -- ── Fidelización ─────────────────────────────────────────────────
    SELECT jsonb_build_object(
             'active_cards', (
               SELECT COUNT(*) FROM loyalty_cards lc WHERE lc.business_id = ANY(p_business_ids)
             ),
             'rewards_redeemed', (
               SELECT COUNT(*) FROM loyalty_transactions lt
               WHERE lt.business_id = ANY(p_business_ids)
                 AND lt.transaction_type = 'reward_redeemed'
                 AND lt.created_at BETWEEN p_from AND p_to
             ),
             'discount_given', (
               SELECT COALESCE(SUM(lt.discount_applied), 0) FROM loyalty_transactions lt
               WHERE lt.business_id = ANY(p_business_ids)
                 AND lt.transaction_type = 'reward_redeemed'
                 AND lt.created_at BETWEEN p_from AND p_to
             ),
             'programs_active', (
               SELECT COUNT(*) FROM loyalty_programs lp
               WHERE lp.business_id = ANY(p_business_ids) AND lp.is_active
             )
           )
    INTO v_loyalty;

    RETURN jsonb_build_object(
      'services',      v_services,
      'hours',         v_hours,
      'weekdays',      v_weekdays,
      'occupancy',     v_occupancy,
      'lead_time',     v_lead,
      'payments',      v_payments,
      'clients',       COALESCE(v_clients, '{}'::jsonb),
      'top_clients',   v_top_clients,
      'notifications', v_notifications,
      'loyalty',       v_loyalty
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_hub_analytics(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hub_analytics(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.get_hub_analytics(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Composición del negocio: servicios, franjas horarias, días, ocupación, '
  'antelación de reserva, medios de pago, clientes, avisos y fidelización.';
