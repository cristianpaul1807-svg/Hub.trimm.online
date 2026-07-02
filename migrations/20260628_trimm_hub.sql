-- ============================================
-- TRIMM Hub — Tablas y políticas RLS
-- ============================================

-- Tabla de conexiones Hub ↔ Negocios
CREATE TABLE IF NOT EXISTS public.hub_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    label TEXT, -- nombre personalizado opcional para esa sucursal en el hub
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    UNIQUE(hub_owner_id, business_id)
);

-- Tabla de tokens de vinculación
CREATE TABLE IF NOT EXISTS public.hub_claim_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '7 days'),
    is_used BOOLEAN DEFAULT false NOT NULL,
    used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    used_at TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- ÍNDICES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_hub_connections_owner ON public.hub_connections(hub_owner_id);
CREATE INDEX IF NOT EXISTS idx_hub_connections_business ON public.hub_connections(business_id);
CREATE INDEX IF NOT EXISTS idx_hub_claim_tokens_business ON public.hub_claim_tokens(business_id);
CREATE INDEX IF NOT EXISTS idx_hub_claim_tokens_token ON public.hub_claim_tokens(token);

-- ============================================
-- RLS — Row Level Security
-- ============================================
ALTER TABLE public.hub_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_claim_tokens ENABLE ROW LEVEL SECURITY;

-- hub_connections: cada hub owner solo ve sus propias conexiones
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hub_owner_select' AND tablename = 'hub_connections') THEN
        CREATE POLICY "hub_owner_select" ON public.hub_connections FOR SELECT USING (hub_owner_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hub_owner_insert' AND tablename = 'hub_connections') THEN
        CREATE POLICY "hub_owner_insert" ON public.hub_connections FOR INSERT WITH CHECK (hub_owner_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hub_owner_delete' AND tablename = 'hub_connections') THEN
        CREATE POLICY "hub_owner_delete" ON public.hub_connections FOR DELETE USING (hub_owner_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'business_owner_manage_tokens' AND tablename = 'hub_claim_tokens') THEN
        CREATE POLICY "business_owner_manage_tokens" ON public.hub_claim_tokens FOR ALL USING (
            business_id IN (
                SELECT id FROM public.businesses WHERE owner_id = auth.uid()
            )
        );
    END IF;
END
$$;

-- ============================================
-- FUNCIÓN: Consumir un claim token
-- ============================================
CREATE OR REPLACE FUNCTION public.claim_hub_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token_row hub_claim_tokens%ROWTYPE;
    v_connection_id UUID;
BEGIN
    -- Buscar el token
    SELECT * INTO v_token_row
    FROM hub_claim_tokens
    WHERE token = p_token
      AND is_used = false
      AND (expires_at IS NULL OR expires_at > now());

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Token inválido o expirado');
    END IF;

    -- Verificar que esta combinación no existe ya
    IF EXISTS (
        SELECT 1 FROM hub_connections
        WHERE hub_owner_id = auth.uid()
          AND business_id = v_token_row.business_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este negocio ya está vinculado');
    END IF;

    -- Crear la conexión
    INSERT INTO hub_connections (hub_owner_id, business_id)
    VALUES (auth.uid(), v_token_row.business_id)
    RETURNING id INTO v_connection_id;

    -- Marcar token como usado
    UPDATE hub_claim_tokens
    SET is_used = true,
        used_by = auth.uid(),
        used_at = now()
    WHERE id = v_token_row.id;

    RETURN jsonb_build_object(
        'success', true,
        'connection_id', v_connection_id,
        'business_id', v_token_row.business_id
    );
END;
$$;

-- ============================================
-- FUNCIÓN: Obtener métricas agregadas del Hub
-- ============================================
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
    -- Verificar que el usuario tiene acceso a TODOS los business_ids pedidos
    IF EXISTS (
        SELECT 1 FROM unnest(p_business_ids) AS bid
        WHERE bid NOT IN (
            SELECT business_id FROM hub_connections WHERE hub_owner_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'Acceso denegado a uno o más negocios';
    END IF;

    SELECT jsonb_build_object(
        'total_revenue', COALESCE(SUM(a.price), 0),
        'total_appointments', COUNT(a.id) FILTER (WHERE a.status = 'COMPLETED'),
        'cancelled_appointments', COUNT(a.id) FILTER (WHERE a.status IN ('CANCELLED', 'CANCELLED_CLIENT', 'CANCELED')),
        'new_clients', (
            SELECT COUNT(DISTINCT c.id)
            FROM clients c
            WHERE c.business_id = ANY(p_business_ids)
              AND c.created_at BETWEEN p_from AND p_to
        ),
        'avg_ticket', COALESCE(
            AVG(a.price) FILTER (WHERE a.status = 'COMPLETED' AND a.price > 0),
            0
        ),
        'active_loyalty_cards', (
            SELECT COUNT(*)
            FROM loyalty_cards lc
            WHERE lc.business_id = ANY(p_business_ids)
        ),
        'discounts_applied', (
            SELECT COALESCE(SUM(lt.discount_applied), 0)
            FROM loyalty_transactions lt
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

-- ============================================
-- FUNCIÓN: Métricas por empleado para el Hub
-- ============================================
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
      AND s.active = true
    GROUP BY s.id, s.name, b.id, b.name
    ORDER BY total_revenue DESC;
END;
$$;
