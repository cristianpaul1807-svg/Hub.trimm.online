-- ============================================================
-- TRIMM Hub — El idioma de la plantilla llega hasta el correo
--
-- El renderizador pone textos propios dentro del correo: la etiqueta del
-- código, la instrucción de reserva y el pie entero («Recibes este correo
-- porque eres cliente de…», «Darse de baja…»). Estaban en español fijo.
--
-- Con un solo idioma no se notaba. Desde que el catálogo existe en cinco,
-- una plantilla italiana sale con el cuerpo en italiano y «TU CÓDIGO» en
-- español — y quien lo recibe no entiende la mitad del mensaje. No es un
-- detalle de la pantalla: es el correo que le llega a la clienta de un
-- salón de Milán.
--
-- Para traducirlos, el renderizador necesita saber en qué idioma está la
-- plantilla, y hub_render_context es quien se lo lleva al worker. Enumera
-- las columnas una a una, así que hay que añadirla aquí también — que es
-- exactamente lo que avisaba el comentario que dejamos al añadir cta_url.
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
      'lang',         v_t.lang,
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
