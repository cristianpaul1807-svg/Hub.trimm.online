-- ============================================================
-- TRIMM Hub — Plantillas de correo y marca propia
--
-- Hasta ahora había tres plantillas escritas a fuego en el código. Elegir
-- una era elegir entre tres, y personalizarla exigía un despliegue.
--
-- A partir de aquí: un catálogo de plantillas del sistema que cualquiera
-- puede duplicar y modificar, más la marca del grupo (logotipo, color,
-- firma) que se aplica a todas.
--
-- ── Por qué contenido estructurado y no HTML libre ──────────────────
--
-- La tentación es dar un editor de HTML. No se hace, por dos razones que
-- cuestan dinero:
--
--   1. El HTML de correo es frágil. Lo que se ve bien en Gmail se descuadra
--      en Outlook. Las maquetas de aquí están probadas y usan tablas y
--      estilos en línea, que es lo único que aguanta en todos los clientes.
--
--   2. Ese texto acaba dentro del HTML que sale hacia miles de buzones. Sin
--      escapado, un `<script>` o un `"` mal puesto rompe el correo entero, y
--      con mala intención es una vía de inyección. El renderizador escapa
--      todo lo que viene de la base de datos.
--
-- Se personaliza lo que importa —maqueta, asunto, preencabezado, titular,
-- cuerpo, botón, color, imagen, logotipo y firma— sin poder romper el envío.
-- ============================================================

-- ── 1. Marca del grupo ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_brand (
  hub_owner_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  logo_url      TEXT,
  accent_color  TEXT NOT NULL DEFAULT '#1d4ed8'
    CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  from_name     TEXT,      -- si está vacío, firma el nombre de la sucursal
  signature     TEXT,
  footer_note   TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.hub_brand.accent_color IS
  'Color del botón y las cabeceras. Con CHECK porque este valor entra en un '
  'atributo style del correo: si no es un color válido, es inyección.';

-- ── 2. Catálogo de plantillas ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_email_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = plantilla del sistema, visible para todos y no editable.
  hub_owner_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,

  layout        TEXT NOT NULL DEFAULT 'hero'
    CHECK (layout IN ('hero', 'offer', 'plain', 'card')),

  subject       TEXT NOT NULL,
  preheader     TEXT,          -- la línea gris que Gmail enseña junto al asunto
  headline      TEXT,
  body          TEXT NOT NULL,
  cta_label     TEXT,
  accent_color  TEXT CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  image_url     TEXT,

  is_system     BOOLEAN NOT NULL DEFAULT false,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un código único por dueño; los del sistema, únicos entre ellos. En
-- PostgreSQL dos NULL no chocan en un UNIQUE normal, de ahí los dos índices.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_templates_sistema
  ON public.hub_email_templates(code) WHERE hub_owner_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_templates_propias
  ON public.hub_email_templates(hub_owner_id, code) WHERE hub_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_templates_owner
  ON public.hub_email_templates(hub_owner_id) WHERE active;

-- ── 3. La campaña apunta a su plantilla ─────────────────────────────
ALTER TABLE public.hub_campaigns
  ADD COLUMN IF NOT EXISTS template_id UUID
    REFERENCES public.hub_email_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.hub_campaigns.template_id IS
  'Plantilla elegida. template_type se mantiene por compatibilidad con las '
  'campañas anteriores y con el camino de respaldo del worker.';

-- ── 4. Plantillas del sistema ───────────────────────────────────────
-- Seis puntos de partida que cubren lo que un salón manda de verdad. Se
-- duplican y se retocan; los originales no se tocan.
INSERT INTO public.hub_email_templates
  (hub_owner_id, code, name, description, layout, subject, preheader, headline, body, cta_label, accent_color, is_system)
VALUES
  (NULL, 'descuento', 'Descuento', 'Una oferta concreta con su porcentaje bien visible.',
   'offer',
   '{{descuento}}% de descuento para ti en {{negocio}}',
   'Tu descuento te espera. Reservar lleva menos de un minuto.',
   '{{descuento}}%',
   E'Hola {{cliente}},\n\nHemos guardado un {{descuento}}% de descuento a tu nombre para tu próxima visita a {{negocio}}.\n\nSe aplica solo con reservar desde este correo.',
   'Reservar con descuento', '#1d4ed8', true),

  (NULL, 'recuperacion', 'Te echamos de menos', 'Para quien hace tiempo que no aparece.',
   'hero',
   '{{negocio}} te echa de menos',
   'Hace tiempo que no nos vemos. Tu sitio sigue aquí.',
   'Hace tiempo que no nos vemos',
   E'Hola {{cliente}},\n\nHemos notado que hace un tiempo que no pasas por {{negocio}}.\n\nTu sitio sigue esperándote, y reservar te lleva menos de un minuto.',
   'Reservar mi cita', '#1d4ed8', true),

  (NULL, 'fidelidad', 'Tarjeta de fidelidad', 'Presenta el programa de puntos.',
   'card',
   'Tu tarjeta de fidelidad en {{negocio}}',
   'Cada visita suma. Activarla es gratis.',
   'Programa de fidelidad',
   E'Hola {{cliente}},\n\nEn {{negocio}} cada visita suma puntos, y cada cierto número de puntos te llevas una recompensa.\n\nActivar tu tarjeta es gratis y solo se hace una vez.',
   'Activar mi tarjeta', '#059669', true),

  (NULL, 'novedad', 'Servicio nuevo', 'Para anunciar algo que antes no ofrecías.',
   'hero',
   'Novedad en {{negocio}}',
   'Tenemos algo nuevo que enseñarte.',
   'Algo nuevo en {{negocio}}',
   E'Hola {{cliente}},\n\nHemos incorporado un servicio nuevo y queríamos que fueras de los primeros en saberlo.\n\nCuéntanos qué te parece la próxima vez que vengas.',
   'Ver disponibilidad', '#7c3aed', true),

  (NULL, 'huecos', 'Huecos esta semana', 'Para llenar una semana floja. Va bien con lo que marque la ocupación en Análisis.',
   'plain',
   '¿Te viene bien esta semana en {{negocio}}?',
   'Nos han quedado huecos libres estos días.',
   NULL,
   E'Hola {{cliente}},\n\nEsta semana nos han quedado algunos huecos libres en {{negocio}}.\n\nSi te apetece pasarte, puedes coger el que mejor te venga desde aquí.',
   'Ver huecos libres', '#1d4ed8', true),

  (NULL, 'gracias', 'Gracias por tu visita', 'Un mensaje breve después de venir.',
   'plain',
   'Gracias por pasarte por {{negocio}}',
   'Un placer verte. Aquí tienes tu próxima cita cuando quieras.',
   NULL,
   E'Hola {{cliente}},\n\nGracias por confiar en {{negocio}}. Ha sido un placer atenderte.\n\nCuando quieras repetir, ya sabes dónde estamos.',
   'Reservar de nuevo', '#0f766e', true)
ON CONFLICT DO NOTHING;

-- ── 5. Seguridad ────────────────────────────────────────────────────
ALTER TABLE public.hub_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_brand           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hub_templates_leer   ON public.hub_email_templates;
DROP POLICY IF EXISTS hub_templates_crear  ON public.hub_email_templates;
DROP POLICY IF EXISTS hub_templates_editar ON public.hub_email_templates;
DROP POLICY IF EXISTS hub_templates_borrar ON public.hub_email_templates;

-- Se ven las del sistema y las propias. Las de otro grupo, no.
CREATE POLICY hub_templates_leer ON public.hub_email_templates
  FOR SELECT TO authenticated
  USING (hub_owner_id IS NULL OR hub_owner_id = auth.uid());

-- Al crear no se puede colar hub_owner_id ajeno ni marcar algo como del
-- sistema: is_system daría visibilidad a todos los grupos.
CREATE POLICY hub_templates_crear ON public.hub_email_templates
  FOR INSERT TO authenticated
  WITH CHECK (hub_owner_id = auth.uid() AND is_system = false);

-- Las del sistema no se editan ni se borran: son el punto de partida al que
-- volver cuando alguien deja su copia inservible.
CREATE POLICY hub_templates_editar ON public.hub_email_templates
  FOR UPDATE TO authenticated
  USING (hub_owner_id = auth.uid() AND is_system = false)
  WITH CHECK (hub_owner_id = auth.uid() AND is_system = false);

CREATE POLICY hub_templates_borrar ON public.hub_email_templates
  FOR DELETE TO authenticated
  USING (hub_owner_id = auth.uid() AND is_system = false);

DROP POLICY IF EXISTS hub_brand_todo ON public.hub_brand;
CREATE POLICY hub_brand_todo ON public.hub_brand
  FOR ALL TO authenticated
  USING (hub_owner_id = auth.uid())
  WITH CHECK (hub_owner_id = auth.uid());

-- ── 6. Lo que el worker necesita para enviar ────────────────────────
-- Devuelve plantilla + marca ya resueltas. La llama el envío con la clave
-- de servicio, así que no se concede a nadie más.
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
  'Plantilla y marca resueltas de una campaña, para el worker de envío.';
