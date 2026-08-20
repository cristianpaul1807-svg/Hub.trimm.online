-- ============================================================
-- TRIMM Hub — Motor de campañas
-- Migration: 20260820_hub_campaign_engine.sql
--
-- Sustituye el envío síncrono por una cola con worker, y añade:
--   · resolución única de audiencia (misma lista para cobrar y para enviar)
--   · lista de supresión + bajas reales con token
--   · registro de consentimiento y permiso comercial del negocio
--   · atribución campaña → reserva → euros
--
-- Idempotente: se puede ejecutar varias veces sin efectos adversos.
-- ============================================================

-- ============================================================
-- 1. CONSENTIMIENTO Y PERMISOS
-- ============================================================

-- Rastro del consentimiento comercial del cliente final.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS marketing_consent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_consent_source TEXT;

-- El negocio debe autorizar explícitamente el uso comercial de su base
-- de clientes al vincularse a un Hub. Por defecto TRUE para no romper las
-- conexiones existentes; el frontend lo pide de forma explícita en las nuevas.
ALTER TABLE public.hub_connections
  ADD COLUMN IF NOT EXISTS marketing_allowed    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS marketing_granted_at TIMESTAMPTZ;

-- Atribución: qué campaña originó esta reserva.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS hub_campaign_id UUID
    REFERENCES public.hub_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_hub_campaign
  ON public.appointments(hub_campaign_id)
  WHERE hub_campaign_id IS NOT NULL;

-- ============================================================
-- 2. LISTA DE SUPRESIÓN
-- Direcciones que no deben recibir nunca más. business_id NULL = global.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hub_email_suppressions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'manual')),
  campaign_id UUID REFERENCES public.hub_campaigns(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un índice único que trata NULL como "global" de forma determinista.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_suppressions_unique
  ON public.hub_email_suppressions (email, COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_hub_suppressions_email
  ON public.hub_email_suppressions(email);

-- ============================================================
-- 3. COLA DE DESTINATARIOS
-- Una fila por destinatario. Es la foto congelada de la audiencia:
-- hace el envío idempotente, reanudable y auditable.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hub_campaign_recipients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES public.hub_campaigns(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  client_name       TEXT,
  unsubscribe_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  status            TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','delivered','opened','clicked',
                      'bounced','complained','unsubscribed','failed')),
  resend_email_id   TEXT,
  attempts          INT  NOT NULL DEFAULT 0,
  error             TEXT,
  sent_at           TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Impide materializar dos veces al mismo destinatario en una campaña.
  UNIQUE (campaign_id, email)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_recipients_token
  ON public.hub_campaign_recipients(unsubscribe_token);

-- Índice parcial: el worker sólo busca lo que sigue en cola.
CREATE INDEX IF NOT EXISTS idx_hub_recipients_pending
  ON public.hub_campaign_recipients(campaign_id, id)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_hub_recipients_resend_id
  ON public.hub_campaign_recipients(resend_email_id)
  WHERE resend_email_id IS NOT NULL;

-- ============================================================
-- 4. AMPLIACIÓN DE hub_campaigns
-- ============================================================

ALTER TABLE public.hub_campaigns
  ADD COLUMN IF NOT EXISTS credits_reserved INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_spent    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS queued_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason   TEXT;

-- Estados nuevos: 'queued' (materializada, lista para el worker) y
-- 'failed'. Se sustituye la restricción anterior.
ALTER TABLE public.hub_campaigns DROP CONSTRAINT IF EXISTS hub_campaigns_status_check;
ALTER TABLE public.hub_campaigns ADD CONSTRAINT hub_campaigns_status_check
  CHECK (status IN ('draft','paid','queued','sending','completed',
                    'paused_no_billing','cancelled','failed'));

ALTER TABLE public.hub_campaign_stats
  ADD COLUMN IF NOT EXISTS emails_delivered   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_clicked     INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_complained  INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unsubscribed       INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_rate         NUMERIC(5,2) DEFAULT 0;

-- ============================================================
-- 5. RESOLUCIÓN DE AUDIENCIA — FUENTE ÚNICA DE VERDAD
--
-- Esta función es la única autorizada para decidir quién recibe una
-- campaña. La usan tanto la estimación que ve el usuario como el
-- encolado real, de modo que es imposible cobrar una lista y enviar otra.
-- ============================================================

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

-- Contador: envoltorio delgado sobre la resolución real, para que la cifra
-- que ve el usuario y la lista que se envía no puedan divergir nunca.
CREATE OR REPLACE FUNCTION public.get_campaign_recipient_count(
  p_business_ids  UUID[],
  p_template_type TEXT DEFAULT 'discount',
  p_days_inactive INT  DEFAULT 30
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM hub_resolve_audience(auth.uid(), p_business_ids, p_template_type, p_days_inactive);
  RETURN COALESCE(v_count, 0);
END;
$$;

-- ============================================================
-- 6. MATERIALIZAR LA COLA
-- Congela la audiencia en hub_campaign_recipients. Idempotente por la
-- restricción única (campaign_id, email): reintentar no duplica.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_materialize_campaign(
  p_campaign_id UUID,
  p_max_recipients INT
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
  -- Bloqueo de la campaña: cierra la ventana de carrera que permitía
  -- materializar (y por tanto enviar) dos veces.
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

  -- El LIMIT va dentro de una subconsulta: aplicarlo directamente sobre el
  -- SELECT de un INSERT ... ON CONFLICT es ambiguo de leer y frágil.
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
  ON CONFLICT (campaign_id, email) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE hub_campaigns
  SET status           = 'queued',
      queued_at        = now(),
      recipients_count = v_inserted
  WHERE id = p_campaign_id;

  RETURN v_inserted;
END;
$$;

-- ============================================================
-- 7. WORKER — RESERVAR UN TRAMO DE LA COLA
-- FOR UPDATE SKIP LOCKED permite varios workers en paralelo sin que
-- ninguno pise el trabajo del otro ni se envíe nada dos veces.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_claim_recipient_batch(
  p_campaign_id UUID,
  p_limit       INT DEFAULT 100
)
RETURNS TABLE (
  id                UUID,
  client_id         UUID,
  business_id       UUID,
  email             TEXT,
  client_name       TEXT,
  unsubscribe_token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  UPDATE hub_campaign_recipients r
  SET status     = 'sending',
      attempts   = r.attempts + 1,
      updated_at = now()
  WHERE r.id IN (
    SELECT r2.id
    FROM hub_campaign_recipients r2
    WHERE r2.campaign_id = p_campaign_id
      AND r2.status = 'queued'
    ORDER BY r2.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING r.id, r.client_id, r.business_id, r.email, r.client_name, r.unsubscribe_token;
END;
$$;

-- Registrar el resultado de cada envío individual.
CREATE OR REPLACE FUNCTION public.hub_mark_recipient(
  p_recipient_id    UUID,
  p_status          TEXT,
  p_resend_email_id TEXT DEFAULT NULL,
  p_error           TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE hub_campaign_recipients
  SET status          = p_status,
      resend_email_id = COALESCE(p_resend_email_id, resend_email_id),
      error           = p_error,
      sent_at         = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END,
      updated_at      = now()
  WHERE id = p_recipient_id;
END;
$$;

-- ============================================================
-- 8. RECUENTO Y CIERRE DE CAMPAÑA
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_refresh_campaign_stats(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
  v_sent INT; v_delivered INT; v_opened INT; v_clicked INT;
  v_bounced INT; v_complained INT; v_unsub INT; v_pending INT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status IN ('sent','delivered','opened','clicked','unsubscribed')),
    COUNT(*) FILTER (WHERE status IN ('delivered','opened','clicked')),
    COUNT(*) FILTER (WHERE status IN ('opened','clicked')),
    COUNT(*) FILTER (WHERE status = 'clicked'),
    COUNT(*) FILTER (WHERE status = 'bounced'),
    COUNT(*) FILTER (WHERE status = 'complained'),
    COUNT(*) FILTER (WHERE status = 'unsubscribed'),
    COUNT(*) FILTER (WHERE status IN ('queued','sending'))
  INTO v_sent, v_delivered, v_opened, v_clicked, v_bounced, v_complained, v_unsub, v_pending
  FROM hub_campaign_recipients
  WHERE campaign_id = p_campaign_id;

  INSERT INTO hub_campaign_stats (
    campaign_id, emails_sent, emails_delivered, emails_opened, emails_clicked,
    emails_bounced, emails_complained, unsubscribed, open_rate, click_rate, updated_at
  ) VALUES (
    p_campaign_id, v_sent, v_delivered, v_opened, v_clicked,
    v_bounced, v_complained, v_unsub,
    CASE WHEN v_delivered > 0 THEN ROUND(100.0 * v_opened  / v_delivered, 2) ELSE 0 END,
    CASE WHEN v_delivered > 0 THEN ROUND(100.0 * v_clicked / v_delivered, 2) ELSE 0 END,
    now()
  )
  ON CONFLICT (campaign_id) DO UPDATE SET
    emails_sent       = EXCLUDED.emails_sent,
    emails_delivered  = EXCLUDED.emails_delivered,
    emails_opened     = EXCLUDED.emails_opened,
    emails_clicked    = EXCLUDED.emails_clicked,
    emails_bounced    = EXCLUDED.emails_bounced,
    emails_complained = EXCLUDED.emails_complained,
    unsubscribed      = EXCLUDED.unsubscribed,
    open_rate         = EXCLUDED.open_rate,
    click_rate        = EXCLUDED.click_rate,
    updated_at        = now();

  -- Cuando no queda nada en cola, la campaña se cierra sola.
  IF v_pending = 0 THEN
    UPDATE hub_campaigns
    SET status        = 'completed',
        completed_at  = COALESCE(completed_at, now()),
        credits_spent = v_sent
    WHERE id = p_campaign_id
      AND status IN ('queued', 'sending');
  END IF;

  v := jsonb_build_object(
    'sent', v_sent, 'delivered', v_delivered, 'opened', v_opened,
    'clicked', v_clicked, 'bounced', v_bounced, 'complained', v_complained,
    'unsubscribed', v_unsub, 'pending', v_pending
  );
  RETURN v;
END;
$$;

-- ============================================================
-- 9. BAJA POR TOKEN — accesible sin sesión desde el email
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_unsubscribe_by_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec hub_campaign_recipients%ROWTYPE;
  v_business_name TEXT;
  v_targets UUID[];
BEGIN
  SELECT * INTO v_rec
  FROM hub_campaign_recipients
  WHERE unsubscribe_token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enlace no válido');
  END IF;

  SELECT name INTO v_business_name FROM businesses WHERE id = v_rec.business_id;
  SELECT target_business_ids INTO v_targets FROM hub_campaigns WHERE id = v_rec.campaign_id;

  -- La baja cubre TODAS las sucursales de la campaña, no solo la que firmaba
  -- el correo. Como una persona puede tener ficha en varias sucursales del
  -- mismo grupo y solo recibe un correo, suprimir únicamente la firmante la
  -- haría reaparecer en el siguiente envío bajo otra sucursal — que es
  -- justo lo que la persona ha pedido que no pase.
  --
  -- No se toca a otros grupos: quien se da de baja de este negocio sigue
  -- pudiendo recibir los de otra empresa distinta a la que sí dio permiso.
  INSERT INTO hub_email_suppressions (email, business_id, reason, campaign_id)
  SELECT v_rec.email, bid, 'unsubscribe', v_rec.campaign_id
  FROM unnest(COALESCE(v_targets, ARRAY[v_rec.business_id])) AS bid
  ON CONFLICT DO NOTHING;

  -- Y se refleja en la preferencia del cliente en Trimm.
  UPDATE clients SET preferencia_email = false WHERE id = v_rec.client_id;

  UPDATE hub_campaign_recipients
  SET status = 'unsubscribed', updated_at = now()
  WHERE id = v_rec.id;

  PERFORM hub_refresh_campaign_stats(v_rec.campaign_id);

  RETURN jsonb_build_object(
    'success', true,
    'email', v_rec.email,
    'business_name', COALESCE(v_business_name, 'TRIMM')
  );
END;
$$;

-- ============================================================
-- 10. INGESTA DE EVENTOS DE RESEND
-- Rebotes duros y quejas de spam entran en supresión automáticamente:
-- es lo que protege la reputación de envío a largo plazo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_apply_email_event(
  p_resend_email_id TEXT,
  p_event_type      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec        hub_campaign_recipients%ROWTYPE;
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_rec
  FROM hub_campaign_recipients
  WHERE resend_email_id = p_resend_email_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Destinatario desconocido');
  END IF;

  v_new_status := CASE p_event_type
    WHEN 'email.delivered'       THEN 'delivered'
    WHEN 'email.opened'          THEN 'opened'
    WHEN 'email.clicked'         THEN 'clicked'
    WHEN 'email.bounced'         THEN 'bounced'
    WHEN 'email.complained'      THEN 'complained'
    WHEN 'email.delivery_delayed' THEN NULL
    ELSE NULL
  END;

  IF v_new_status IS NULL THEN
    RETURN jsonb_build_object('success', true, 'ignored', p_event_type);
  END IF;

  -- El progreso sólo avanza: una apertura tardía no debe degradar un clic.
  UPDATE hub_campaign_recipients
  SET status = v_new_status, updated_at = now()
  WHERE id = v_rec.id
    AND CASE v_new_status
          WHEN 'delivered' THEN status IN ('sent')
          WHEN 'opened'    THEN status IN ('sent','delivered')
          WHEN 'clicked'   THEN status IN ('sent','delivered','opened')
          ELSE true
        END;

  -- Rebote duro o queja: supresión global. Esta dirección no vuelve a
  -- recibir nada de ninguna sucursal.
  IF v_new_status IN ('bounced', 'complained') THEN
    INSERT INTO hub_email_suppressions (email, business_id, reason, campaign_id)
    VALUES (v_rec.email, NULL,
            CASE WHEN v_new_status = 'bounced' THEN 'bounce' ELSE 'complaint' END,
            v_rec.campaign_id)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM hub_refresh_campaign_stats(v_rec.campaign_id);

  RETURN jsonb_build_object('success', true, 'status', v_new_status);
END;
$$;

-- ============================================================
-- 11. RETORNO REAL DE LA CAMPAÑA
-- El diferenciador: no "cuánta gente abrió", sino cuántas reservas
-- y cuántos euros. Sólo es posible porque el calendario es de Trimm.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_campaign_performance(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign  hub_campaigns%ROWTYPE;
  v_stats     JSONB;
  v_bookings  INT;
  v_revenue   NUMERIC;
  v_spend     NUMERIC;
BEGIN
  SELECT * INTO v_campaign FROM hub_campaigns WHERE id = p_campaign_id;

  IF NOT FOUND OR v_campaign.hub_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(a.price) FILTER (WHERE a.status = 'COMPLETED'), 0)
  INTO v_bookings, v_revenue
  FROM appointments a
  WHERE a.hub_campaign_id = p_campaign_id;

  SELECT jsonb_build_object(
    'sent',         COALESCE(emails_sent, 0),
    'delivered',    COALESCE(emails_delivered, 0),
    'opened',       COALESCE(emails_opened, 0),
    'clicked',      COALESCE(emails_clicked, 0),
    'bounced',      COALESCE(emails_bounced, 0),
    'complained',   COALESCE(emails_complained, 0),
    'unsubscribed', COALESCE(unsubscribed, 0),
    'open_rate',    COALESCE(open_rate, 0),
    'click_rate',   COALESCE(click_rate, 0)
  ) INTO v_stats
  FROM hub_campaign_stats WHERE campaign_id = p_campaign_id;

  v_spend := COALESCE(v_campaign.budget_eur, 0);

  RETURN COALESCE(v_stats, '{}'::jsonb) || jsonb_build_object(
    'bookings', v_bookings,
    'revenue',  v_revenue,
    'spend',    v_spend,
    'roi',      CASE WHEN v_spend > 0 THEN ROUND(v_revenue / v_spend, 2) ELSE NULL END
  );
END;
$$;

-- ============================================================
-- 11b. ATRIBUCIÓN DESDE EL FLUJO DE RESERVA DE TRIMM
--
-- El enlace del correo lleva ?tc=<token>. Cuando esa persona reserva,
-- Trimm sólo tiene que pasar el token aquí y la reserva queda ligada a la
-- campaña que la provocó. Es una sola llamada en el lado de Trimm:
--
--   SELECT hub_attribute_appointment('<appointment_id>', '<token>');
--
-- Se ignora en silencio si el token no existe: una reserva nunca debe
-- fallar por un problema de atribución.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_attribute_appointment(
  p_appointment_id UUID,
  p_token          TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id UUID;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN false;
  END IF;

  SELECT campaign_id INTO v_campaign_id
  FROM hub_campaign_recipients
  WHERE unsubscribe_token = p_token;

  IF v_campaign_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE appointments
  SET hub_campaign_id = v_campaign_id
  WHERE id = p_appointment_id
    AND hub_campaign_id IS NULL;   -- la primera campaña se lleva el mérito

  RETURN FOUND;
END;
$$;

-- ============================================================
-- 12. RLS
-- ============================================================

ALTER TABLE public.hub_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_email_suppressions  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hub_recipients_owner' AND tablename = 'hub_campaign_recipients') THEN
    CREATE POLICY "hub_recipients_owner" ON public.hub_campaign_recipients
      FOR SELECT USING (
        campaign_id IN (SELECT id FROM public.hub_campaigns WHERE hub_owner_id = auth.uid())
      );
  END IF;

  -- Las supresiones sólo las gestionan las funciones SECURITY DEFINER y el
  -- service_role. Ningún cliente las lee ni las escribe directamente.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hub_suppressions_no_client' AND tablename = 'hub_email_suppressions') THEN
    CREATE POLICY "hub_suppressions_no_client" ON public.hub_email_suppressions
      FOR SELECT USING (false);
  END IF;
END
$$;

-- ============================================================
-- 13. PERMISOS DE EJECUCIÓN
--
-- El linter de Supabase avisaba de que las funciones SECURITY DEFINER del
-- Hub eran invocables por el rol anónimo. Se cierra explícitamente: sólo
-- la baja por token debe funcionar sin sesión, porque se abre desde un email.
-- ============================================================

REVOKE ALL ON FUNCTION public.hub_resolve_audience(UUID, UUID[], TEXT, INT)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hub_materialize_campaign(UUID, INT)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_claim_recipient_batch(UUID, INT)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_mark_recipient(UUID, TEXT, TEXT, TEXT)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_apply_email_event(TEXT, TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_refresh_campaign_stats(UUID)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_campaign_recipient_count(UUID[], TEXT, INT)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hub_campaign_performance(UUID)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hub_unsubscribe_by_token(TEXT)                      FROM PUBLIC;

-- Lo que el navegador autenticado sí necesita invocar.
GRANT EXECUTE ON FUNCTION public.get_campaign_recipient_count(UUID[], TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_campaign_performance(UUID)                  TO authenticated;

-- La baja se abre desde el correo, sin sesión: es la única excepción.
GRANT EXECUTE ON FUNCTION public.hub_unsubscribe_by_token(TEXT) TO anon, authenticated;

-- La atribución la invoca el flujo de reserva de Trimm, que puede correr
-- con sesión de cliente o sin ella (reserva de invitado).
REVOKE ALL ON FUNCTION public.hub_attribute_appointment(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_attribute_appointment(UUID, TEXT) TO anon, authenticated;

-- Las funciones del motor las llama el worker con service_role, que ignora
-- los GRANT, de modo que no hace falta concedérselas a nadie más.

-- Endurecimiento de las funciones ya existentes que el linter marcaba.
REVOKE ALL ON FUNCTION public.claim_hub_token(TEXT)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_hub_metrics(UUID[], TIMESTAMPTZ, TIMESTAMPTZ)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_hub_staff_metrics(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_hub_token(TEXT)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hub_metrics(UUID[], TIMESTAMPTZ, TIMESTAMPTZ)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hub_staff_metrics(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
