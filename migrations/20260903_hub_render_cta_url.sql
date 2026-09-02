-- ============================================================
-- TRIMM Hub — El enlace del botón también llega al envío
--
-- hub_render_context nombra las columnas de la plantilla una a una en vez
-- de volcarlas enteras, así que al añadir cta_url el campo se guardaba en
-- la pantalla y desaparecía por el camino: el worker nunca lo veía y el
-- botón seguía yendo a la reserva.
--
-- Es el peor tipo de fallo que puede tener este módulo: silencioso y a
-- favor de la apariencia. El usuario configura un destino, la vista previa
-- se lo enseña —porque la vista previa sí lee la plantilla entera— y lo
-- que sale por correo va a otro sitio. Nadie lo descubre hasta que un
-- cliente se queja de que el enlace no lleva donde decía.
--
-- Se enumeran las columnas a propósito, en lugar de volcar la fila entera:
-- así lo que viaja al worker es una lista explícita y no todo lo que haya
-- en la tabla. El precio es exactamente este despiste, y se paga con una
-- migración de cuatro líneas cada vez que se añade un campo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hub_render_context(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c hub_campaigns%ROWTYPE;
  v_t hub_email_templates%ROWTYPE;
  v_b hub_brand%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM hub_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_c.template_id IS NOT NULL THEN
    SELECT * INTO v_t FROM hub_email_templates WHERE id = v_c.template_id;
  END IF;

  -- Sin plantilla explícita se busca la del sistema que corresponda al tipo
  -- antiguo, para que las campañas creadas antes de esto sigan saliendo.
  --
  -- Ahora hay una por idioma, así que se pide la española: es el catálogo
  -- completo y el respaldo de todos los demás. Y de todas formas esta rama
  -- solo la toman campañas antiguas, que se crearon cuando solo había
  -- español.
  IF v_t.id IS NULL THEN
    SELECT * INTO v_t FROM hub_email_templates
     WHERE hub_owner_id IS NULL
       AND lang = 'es'
       AND code = CASE v_c.template_type
                    WHEN 'reengagement' THEN 'recuperacion'
                    WHEN 'loyalty'      THEN 'fidelidad'
                    ELSE 'descuento'
                  END;
  END IF;

  SELECT * INTO v_b FROM hub_brand WHERE hub_owner_id = v_c.hub_owner_id;

  RETURN jsonb_build_object(
    'found', true,
    'template', CASE WHEN v_t.id IS NULL THEN NULL ELSE jsonb_build_object(
      'layout',       v_t.layout,
      'subject',      v_t.subject,
      'preheader',    v_t.preheader,
      'headline',     v_t.headline,
      'body',         v_t.body,
      'cta_label',    v_t.cta_label,
      'cta_url',      v_t.cta_url,
      'accent_color', v_t.accent_color,
      'image_url',    v_t.image_url
    ) END,
    'brand', CASE WHEN v_b.hub_owner_id IS NULL THEN NULL ELSE jsonb_build_object(
      'logo_url',     v_b.logo_url,
      'accent_color', v_b.accent_color,
      'from_name',    v_b.from_name,
      'signature',    v_b.signature,
      'footer_note',  v_b.footer_note
    ) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hub_render_context(UUID) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.hub_render_context(UUID) IS
  'Plantilla y marca resueltas de una campaña, para el worker de envío. '
  'Al añadir una columna a hub_email_templates hay que añadirla aquí.';
