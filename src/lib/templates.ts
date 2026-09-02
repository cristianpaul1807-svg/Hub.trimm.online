import { supabase } from './supabase';

/** Maquetas disponibles. El renderizador del servidor conoce estas cuatro. */
export const LAYOUTS = ['hero', 'offer', 'plain', 'card'] as const;
export type Layout = (typeof LAYOUTS)[number];

/** Lo que se puede escribir entre llaves dentro de asunto, titular o cuerpo. */
export const VARIABLES = ['cliente', 'negocio', 'descuento'] as const;

export interface EmailTemplate {
  id: string;
  hub_owner_id: string | null;
  code: string;
  name: string;
  description: string | null;
  layout: Layout;
  subject: string;
  preheader: string | null;
  headline: string | null;
  body: string;
  cta_label: string | null;
  cta_url: string | null;
  accent_color: string | null;
  image_url: string | null;
  is_system: boolean;
  active: boolean;
  lang: string;
}

export interface Brand {
  hub_owner_id: string;
  logo_url: string | null;
  accent_color: string;
  from_name: string | null;
  signature: string | null;
  footer_note: string | null;
}

/**
 * El catálogo en el idioma del Hub.
 *
 * El filtro por idioma lo hace la base de datos y no el navegador porque el
 * respaldo tiene que ser por plantilla: si mañana se añade una nueva solo
 * en español, quien tenga el Hub en italiano debe verla igualmente —en
 * español— y no quedarse sin ella.
 *
 * Y esto no es cosmético. El texto de estas plantillas no decora la
 * pantalla: es lo que se le manda a los clientes del negocio. Un salón de
 * Milán no puede escribir a su gente en español porque nosotros sembramos
 * el catálogo en español.
 */
export async function fetchTemplates(lang = 'es'): Promise<EmailTemplate[]> {
  const { data, error } = await supabase.rpc('hub_templates_for', { p_lang: lang });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EmailTemplate[])
    .sort((a, b) =>
      Number(b.is_system) - Number(a.is_system) || a.name.localeCompare(b.name));
}

export async function fetchBrand(userId: string): Promise<Brand | null> {
  const { data, error } = await supabase
    .from('hub_brand').select('*').eq('hub_owner_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Brand) ?? null;
}

export async function saveBrand(userId: string, brand: Partial<Brand>): Promise<void> {
  const { error } = await supabase.from('hub_brand').upsert({
    hub_owner_id: userId,
    ...brand,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'hub_owner_id' });
  if (error) throw new Error(error.message);
}

/**
 * Duplica una plantilla para poder editarla.
 *
 * Las del sistema no se tocan: son a las que se vuelve cuando alguien deja
 * su copia inservible. Editar una del sistema es, en realidad, copiarla.
 */
export async function duplicateTemplate(
  source: EmailTemplate,
  userId: string,
  newName: string,
): Promise<EmailTemplate> {
  // El código debe ser único por dueño; se le añade un sufijo si ya existe.
  const base = `${source.code}-copia`;
  const { data: existentes } = await supabase
    .from('hub_email_templates')
    .select('code')
    .eq('hub_owner_id', userId);

  const usados = new Set((existentes ?? []).map((t: any) => t.code));
  let code = base;
  let n = 2;
  while (usados.has(code)) code = `${base}-${n++}`;

  const { data, error } = await supabase
    .from('hub_email_templates')
    .insert({
      hub_owner_id: userId,
      code,
      name: newName,
      description: source.description,
      layout: source.layout,
      subject: source.subject,
      preheader: source.preheader,
      headline: source.headline,
      body: source.body,
      cta_label: source.cta_label,
      cta_url: source.cta_url,
      accent_color: source.accent_color,
      image_url: source.image_url,
      is_system: false,
      lang: source.lang,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as EmailTemplate;
}

export async function saveTemplate(t: EmailTemplate): Promise<void> {
  const { error } = await supabase
    .from('hub_email_templates')
    .update({
      name: t.name,
      description: t.description,
      layout: t.layout,
      subject: t.subject,
      preheader: t.preheader,
      headline: t.headline,
      body: t.body,
      cta_label: t.cta_label,
      cta_url: t.cta_url,
      accent_color: t.accent_color,
      image_url: t.image_url,
      updated_at: new Date().toISOString(),
    })
    .eq('id', t.id);
  if (error) throw new Error(error.message);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('hub_email_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export interface TestQuota {
  per_template_limit: number;
  per_template_used: number;
  remaining: number;
  daily_limit: number;
  daily_used: number;
}

/** Cuántas pruebas quedan hoy para esta plantilla. No gasta ninguna. */
export async function fetchTestQuota(templateId: string): Promise<TestQuota | null> {
  const { data, error } = await supabase.rpc('hub_test_quota', { p_template_id: templateId });
  if (error) return null;
  return data as TestQuota;
}

/**
 * Correo de prueba al buzón de la sesión.
 *
 * Va siempre a la dirección con la que se entra al Hub; no hay forma de
 * indicar otra. Y se cuenta contra la plantilla guardada, así que hay que
 * pasar su identificador: sin él el servidor lo rechaza, porque un borrador
 * suelto no tendría contra qué contar.
 */
export async function sendTest(
  templateId: string,
  discountValue = 10,
): Promise<{ sent_to: string; quota: TestQuota }> {
  const { data, error } = await supabase.functions.invoke('hub-template-preview', {
    body: { template_id: templateId, send_test: true, discount_value: discountValue },
  });
  if (error && !data) throw new Error('No se pudo contactar con el servicio');
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Vista previa desde el servidor.
 *
 * Se pide al mismo renderizador que usa el envío, en lugar de reconstruir
 * el HTML en el navegador: si fueran dos implementaciones, tarde o temprano
 * la vista previa enseñaría algo distinto de lo que llega al buzón.
 */
export async function previewTemplate(
  template: Partial<EmailTemplate>,
  opts: { sendTest?: boolean; discountValue?: number } = {},
): Promise<{ subject: string; html: string; sent_to?: string }> {
  const { data, error } = await supabase.functions.invoke('hub-template-preview', {
    body: {
      template: {
        layout: template.layout,
        subject: template.subject,
        preheader: template.preheader,
        headline: template.headline,
        body: template.body,
        cta_label: template.cta_label,
        cta_url: template.cta_url,
        accent_color: template.accent_color,
        image_url: template.image_url,
      },
      send_test: !!opts.sendTest,
      discount_value: opts.discountValue ?? 10,
    },
  });

  if (error && !data) throw new Error('No se pudo contactar con el servicio');
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Vista previa de una campaña del asistente ────────────────────────
// El asistente no usa plantillas guardadas: la maqueta la decide el tipo
// de campaña. Se pide al servidor por el mismo camino que la vista previa
// de plantillas, para que lo que se ve sea lo que se manda.

/** Cuántas pruebas quedan hoy para este tipo de campaña. No gasta ninguna. */
export async function fetchCampaignQuota(campaignType: string): Promise<TestQuota | null> {
  const { data, error } = await supabase.rpc('hub_test_quota_key', {
    p_key: `campana:${campaignType}`,
  });
  if (error) return null;
  return data as TestQuota;
}

export async function previewCampaign(
  campaignType: string,
  opts: { discountValue?: number; businessName?: string } = {},
): Promise<{ subject: string; html: string }> {
  const { data, error } = await supabase.functions.invoke('hub-template-preview', {
    body: {
      campaign_type: campaignType,
      discount_value: opts.discountValue,
      business_name: opts.businessName,
    },
  });
  if (error && !data) throw new Error('No se pudo generar la vista previa');
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Prueba de una campaña al buzón de la sesión.
 *
 * El destinatario no se puede elegir: lo pone el servidor a partir de la
 * sesión. Se cuenta contra el tipo de campaña, 2 al día.
 */
export async function sendCampaignTest(
  campaignType: string,
  opts: { discountValue?: number; businessName?: string } = {},
): Promise<{ sent_to: string; quota: TestQuota }> {
  const { data, error } = await supabase.functions.invoke('hub-template-preview', {
    body: {
      campaign_type: campaignType,
      discount_value: opts.discountValue,
      business_name: opts.businessName,
      send_test: true,
    },
  });
  if (error && !data) throw new Error('No se pudo contactar con el servicio');
  if (data?.error) throw new Error(data.error);
  return data;
}
