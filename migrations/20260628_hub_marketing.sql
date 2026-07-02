-- ============================================================
-- TRIMM Hub Marketing Module
-- Migration: 20260628_hub_marketing.sql
-- ============================================================

-- 1. hub_billing — Método de pago Stripe del propietario del Hub
CREATE TABLE IF NOT EXISTS public.hub_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_pm_id TEXT,
  card_brand TEXT,
  card_last4 TEXT,
  card_exp_month INT,
  card_exp_year INT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (hub_owner_id)
);

-- 2. hub_campaigns — Campañas de email
CREATE TABLE IF NOT EXISTS public.hub_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL CHECK (template_type IN ('reengagement', 'discount', 'loyalty')),
  target_business_ids UUID[] NOT NULL DEFAULT '{}',
  target_all BOOLEAN NOT NULL DEFAULT false,
  budget_eur NUMERIC(10, 2) NOT NULL DEFAULT 0,
  price_per_email NUMERIC(6, 4) NOT NULL DEFAULT 0.01,
  recipients_count INT NOT NULL DEFAULT 0,
  discount_value INT, -- porcentaje de descuento (nullable)
  custom_subject TEXT,
  custom_body TEXT,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'paid', 'sending', 'completed', 'paused_no_billing', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 3. hub_campaign_stats — Métricas post-envío
CREATE TABLE IF NOT EXISTS public.hub_campaign_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.hub_campaigns(id) ON DELETE CASCADE,
  emails_sent INT DEFAULT 0,
  emails_opened INT DEFAULT 0,
  emails_bounced INT DEFAULT 0,
  open_rate NUMERIC(5, 2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (campaign_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_hub_billing_owner ON public.hub_billing(hub_owner_id);
CREATE INDEX IF NOT EXISTS idx_hub_campaigns_owner ON public.hub_campaigns(hub_owner_id);
CREATE INDEX IF NOT EXISTS idx_hub_campaigns_status ON public.hub_campaigns(status);

-- RLS
ALTER TABLE public.hub_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_campaign_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_billing_owner" ON public.hub_billing
  USING (hub_owner_id = auth.uid());

CREATE POLICY "hub_campaigns_owner" ON public.hub_campaigns
  USING (hub_owner_id = auth.uid());

CREATE POLICY "hub_campaign_stats_owner" ON public.hub_campaign_stats
  USING (
    campaign_id IN (
      SELECT id FROM public.hub_campaigns WHERE hub_owner_id = auth.uid()
    )
  );

-- ============================================================
-- RPC: get_campaign_recipient_count
-- Cuenta cuántos clientes únicos hay en las sucursales objetivo
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_campaign_recipient_count(
  p_business_ids UUID[],
  p_template_type TEXT DEFAULT 'discount',
  p_days_inactive INT DEFAULT 30
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := now() - (p_days_inactive || ' days')::INTERVAL;

  IF p_template_type = 'reengagement' THEN
    -- Clientes con citas canceladas en los últimos p_days_inactive días
    SELECT COUNT(DISTINCT c.email)
    INTO v_count
    FROM public.clients c
    JOIN public.appointments a ON a.client_id = c.id
    WHERE a.business_id = ANY(p_business_ids)
      AND a.status IN ('CANCELLED', 'CANCELLED_CLIENT', 'CANCELED')
      AND a.start_time >= v_cutoff
      AND c.email IS NOT NULL
      AND c.email != '';
  ELSE
    -- Todos los clientes de las sucursales seleccionadas
    SELECT COUNT(DISTINCT c.email)
    INTO v_count
    FROM public.clients c
    JOIN public.appointments a ON a.client_id = c.id
    WHERE a.business_id = ANY(p_business_ids)
      AND c.email IS NOT NULL
      AND c.email != '';
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- RPC: pause_campaigns_for_owner (llamado cuando se desconecta el pago)
CREATE OR REPLACE FUNCTION public.pause_campaigns_for_owner(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.hub_campaigns
  SET status = 'paused_no_billing'
  WHERE hub_owner_id = p_owner_id
    AND status IN ('paid', 'sending', 'draft');
END;
$$;
