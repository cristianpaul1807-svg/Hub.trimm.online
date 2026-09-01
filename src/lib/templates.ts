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
  accent_color: string | null;
  image_url: string | null;
  is_system: boolean;
  active: boolean;
}

export interface Brand {
  hub_owner_id: string;
  logo_url: string | null;
  accent_color: string;
  from_name: string | null;
  signature: string | null;
  footer_note: string | null;
}

/** Las del sistema primero: son el punto de partida. */
export async function fetchTemplates(): Promise<EmailTemplate[]> {
  const { data, error } = await supabase
    .from('hub_email_templates')
    .select('*')
    .eq('active', true)
    .order('is_system', { ascending: false })
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as EmailTemplate[];
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
      accent_color: source.accent_color,
      image_url: source.image_url,
      is_system: false,
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
