-- ============================================================
-- TRIMM Hub — Lo que faltaba del lado de Stripe
--
-- Los packs no necesitan catálogo en Stripe: se cobran con PaymentIntents
-- de importe libre, y el precio vive en hub_credit_packs. Lo que sí
-- faltaba era un webhook, y con él dos funciones.
--
-- 1. El agujero del pago perdido
--
--    Hasta ahora el saldo sólo se acreditaba si el navegador volvía a
--    llamar tras confirmar el pago. Si el cliente cerraba la pestaña, se
--    quedaba sin cobertura o se le apagaba el móvil justo después de
--    pagar, el cobro quedaba hecho en Stripe y el saldo sin acreditar. El
--    propio frontend lo admitía: «El pago se realizó pero no pudimos
--    acreditar el saldo. Contacta con soporte.»
--
--    hub_credit_purchase ya era idempotente sobre el PaymentIntent — el
--    comentario original decía «si Stripe reintenta el webhook» —, así que
--    el webhook y el navegador pueden acreditar los dos sin duplicar nada.
--    Gana quien llegue primero.
--
-- 2. La devolución que no devolvía nada
--
--    Comprar 50.000 envíos, lanzar la campaña y pedir la devolución salía
--    gratis: el dinero volvía y el saldo se quedaba. hub_revoke_purchase
--    cierra eso.
-- ============================================================

-- ── Retirada de saldo por devolución o disputa ──────────────────────
--
-- No deja el saldo en negativo: lo ya gastado está gastado, los correos
-- salieron y no vuelven. Lo que hace es dejar el lote a cero para que no
-- pueda gastarse lo que queda, y anotar en el libro mayor cuánto se retiró
-- y cuánto era ya irrecuperable.
CREATE OR REPLACE FUNCTION public.hub_revoke_purchase(
  p_payment_intent TEXT,
  p_reason         TEXT DEFAULT 'refund',
  p_note           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot     hub_credit_lots%ROWTYPE;
  v_revoked INT;
  v_spent   INT;
BEGIN
  IF p_payment_intent IS NULL OR p_payment_intent = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Falta el PaymentIntent');
  END IF;

  SELECT * INTO v_lot
  FROM hub_credit_lots
  WHERE stripe_payment_intent_id = p_payment_intent
  FOR UPDATE;

  -- Que no exista es un resultado normal, no un error: puede ser una
  -- devolución de un cobro que nunca llegó a acreditar saldo, o un pago de
  -- Trimm que no tiene nada que ver con el Hub.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'not_found', true, 'revoked', 0);
  END IF;

  v_revoked := v_lot.credits_remaining;
  v_spent   := v_lot.credits_total - v_lot.credits_remaining;

  IF v_revoked = 0 THEN
    RETURN jsonb_build_object(
      'success', true, 'revoked', 0, 'already_spent', v_spent,
      'note', 'El lote ya estaba agotado'
    );
  END IF;

  UPDATE hub_credit_lots
  SET credits_remaining = 0,
      expires_at        = LEAST(expires_at, now())
  WHERE id = v_lot.id;

  INSERT INTO hub_credit_ledger (hub_owner_id, lot_id, delta_credits, reason, note)
  VALUES (
    v_lot.hub_owner_id, v_lot.id, -v_revoked, p_reason,
    COALESCE(p_note, 'Retirada de saldo por ' || p_reason)
      || CASE WHEN v_spent > 0
              THEN ' · ' || v_spent || ' envíos ya gastados, no recuperables'
              ELSE '' END
  );

  RETURN jsonb_build_object(
    'success', true,
    'revoked', v_revoked,
    'already_spent', v_spent,
    'hub_owner_id', v_lot.hub_owner_id
  );
END;
$$;

-- ── Permisos ────────────────────────────────────────────────────────
-- Sólo la clave de servicio, desde el webhook. Nadie con sesión de
-- navegador debe poder retirarle saldo a nadie.
REVOKE ALL ON FUNCTION public.hub_revoke_purchase(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.hub_revoke_purchase(TEXT, TEXT, TEXT) IS
  'Retira el saldo no gastado de una compra devuelta o disputada. La llama '
  'hub-stripe-webhook con charge.refunded y charge.dispute.created.';
