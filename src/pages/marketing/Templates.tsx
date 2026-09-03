import { useState, useEffect, useCallback, useRef } from 'react';
import { useHubAuth } from '../../contexts/HubAuthContext';
import { useHubLang } from '../../contexts/HubLanguageContext';
import {
  fetchTemplates, fetchBrand, saveBrand, duplicateTemplate, saveTemplate,
  deleteTemplate, previewTemplate, sendTest, fetchTestQuota, LAYOUTS, VARIABLES,
  type EmailTemplate, type Brand, type Layout, type TestQuota,
} from '../../lib/templates';

/**
 * Plantillas de correo.
 *
 * Tres cosas en una pantalla: el catálogo, el editor y la vista previa.
 * La previa la calcula el servidor con el mismo renderizador que envía —no
 * una copia en el navegador— porque dos implementaciones acaban divergiendo
 * y entonces la previa miente.
 */

const COLORES = ['#1d4ed8', '#7c3aed', '#059669', '#0f766e', '#dc2626', '#ea580c', '#0f172a'];

export default function Templates() {
  const { user } = useHubAuth();
  const { t, lang } = useHubLang();

  const [items, setItems] = useState<EmailTemplate[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [sel, setSel] = useState<EmailTemplate | null>(null);
  const [draft, setDraft] = useState<EmailTemplate | null>(null);
  const [html, setHtml] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [brandOpen, setBrandOpen] = useState(false);
  const [quota, setQuota] = useState<TestQuota | null>(null);

  const cargar = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [tpls, br] = await Promise.all([fetchTemplates(lang), fetchBrand(user.id)]);
      setItems(tpls);
      setBrand(br);

      // Al cambiar el idioma no basta con recargar la lista: la plantilla
      // elegida sigue siendo la de antes, y la vista previa se queda en el
      // idioma anterior aunque el catálogo ya esté en el nuevo. Se salta a
      // la equivalente —la del mismo código— para que el correo cambie de
      // idioma cuando lo cambia el Hub.
      //
      // Si la elegida era propia, no tiene equivalente en otro idioma: la
      // escribió su dueño en el que quiso y se queda como está.
      setSel((actual) => {
        if (!actual) return tpls[0] ?? null;
        return tpls.find((t) => t.id === actual.id)
          ?? tpls.find((t) => t.is_system && t.code === actual.code)
          ?? tpls[0]
          ?? null;
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, lang]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => { setDraft(sel ? { ...sel } : null); }, [sel]);

  // Cuántas pruebas quedan hoy para la plantilla elegida.
  useEffect(() => {
    if (!sel) { setQuota(null); return; }
    fetchTestQuota(sel.id).then(setQuota);
  }, [sel]);

  // ── Vista previa, con freno ───────────────────────────────────────
  // Se espera a que deje de escribir. Sin esto sería una llamada por tecla.
  const temporizador = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!draft?.body || !draft?.subject) return;
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(async () => {
      try {
        const r = await previewTemplate(draft);
        setHtml(r.html);
        setSubject(r.subject);
        setError('');
      } catch (e: any) {
        setError(e.message);
      }
    }, 500);
    return () => window.clearTimeout(temporizador.current);
  }, [draft]);

  const editable = !!draft && !draft.is_system;

  const set = <K extends keyof EmailTemplate>(k: K, v: EmailTemplate[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const aviso = (texto: string) => { setMsg(texto); setTimeout(() => setMsg(''), 4000); };

  const duplicar = async () => {
    if (!sel || !user) return;
    setBusy(true); setError('');
    try {
      const copia = await duplicateTemplate(sel, user.id, `${sel.name} (${t.templates.copy})`);
      await cargar();
      setSel(copia);
      aviso(t.templates.duplicated);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const guardar = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      await saveTemplate(draft);
      await cargar();
      setSel(draft);
      aviso(t.templates.saved);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const borrar = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      await deleteTemplate(draft.id);
      setSel(null);
      await cargar();
      aviso(t.templates.deleted);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const enviarPrueba = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      // La prueba se cuenta contra la plantilla guardada, así que lo que se
      // envía tiene que estar guardado. Si hay cambios sin guardar se
      // guardan primero, en lugar de mandar algo distinto de lo que se ve.
      const hayCambios = editable && sel && JSON.stringify(draft) !== JSON.stringify(sel);
      if (hayCambios) {
        await saveTemplate(draft);
        await cargar();
      }

      const r = await sendTest(draft.id);
      setQuota(r.quota);
      aviso(`${t.templates.testSent} ${r.sent_to ?? ''}`);
    } catch (e: any) {
      setError(e.message);
      // Si el rechazo fue por cupo, se refresca para que el contador de la
      // pantalla no siga diciendo que quedan pruebas.
      if (draft) fetchTestQuota(draft.id).then(setQuota);
    } finally { setBusy(false); }
  };

  const guardarMarca = async (b: Partial<Brand>) => {
    if (!user) return;
    setBusy(true); setError('');
    try {
      await saveBrand(user.id, b);
      setBrand(await fetchBrand(user.id));
      aviso(t.templates.brandSaved);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const campo = 'w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:border-accent focus:outline-none transition-colors';
  const etiqueta = 'text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">{t.templates.title}</h2>
          <p className="text-sm text-slate-500 font-medium mt-1">{t.templates.subtitle}</p>
        </div>
        {/* El envío de prueba vive aquí y no junto a la vista previa: en
            el móvil las tres columnas se apilan, y la vista previa queda
            detrás de todo el formulario. Un botón al que hay que bajar dos
            pantallas es un botón que no existe. */}
        <div className="flex items-start gap-2">
          <div className="text-right">
            <button
              onClick={enviarPrueba}
              disabled={busy || !draft || quota?.remaining === 0}
              className="bg-white border border-slate-200 hover:border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center gap-2"
            >
              <span className="material-symbols-outlined notranslate text-[16px]" translate="no">outgoing_mail</span>
              {t.templates.sendTest}
            </button>
            {draft && quota && (
              <p className="text-[10px] font-bold text-slate-400 mt-1">
                {quota.remaining > 0
                  ? t.templates.testsLeft.replace('{n}', String(quota.remaining))
                  : t.templates.testsSpent}
              </p>
            )}
          </div>

          <button
            onClick={() => setBrandOpen((o) => !o)}
            className="bg-white border border-slate-200 hover:border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined notranslate text-[16px]" translate="no">palette</span>
            {t.templates.brand}
          </button>
        </div>
      </div>

      {msg && (
        <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">{msg}</p>
      )}
      {error && (
        <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
      )}

      {brandOpen && (
        <BrandPanel brand={brand} onSave={guardarMarca} busy={busy} t={t} campo={campo} etiqueta={etiqueta} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Catálogo ──────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-2">
          {loading && <div className="h-64 bg-white border border-slate-200 rounded-2xl animate-pulse" />}
          {items.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => setSel(tpl)}
              className={`w-full text-left p-4 rounded-xl border transition-all
                ${sel?.id === tpl.id
                  ? 'border-accent bg-blue-50/60'
                  : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-black text-slate-900 truncate">{tpl.name}</span>
                <span
                  className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                  style={{ background: tpl.accent_color ?? brand?.accent_color ?? '#1d4ed8' }}
                />
              </div>
              <p className="text-[11px] text-slate-400 font-semibold line-clamp-2">
                {tpl.description ?? ''}
              </p>
              <span className={`inline-block mt-2 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full
                ${tpl.is_system ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-accent'}`}>
                {tpl.is_system ? t.templates.system : t.templates.mine}
              </span>
            </button>
          ))}
        </div>

        {/* ── Editor ────────────────────────────────────────────── */}
        <div className="lg:col-span-4 space-y-4">
          {!draft && !loading && (
            <p className="text-sm font-bold text-slate-400">{t.templates.pickOne}</p>
          )}

          {draft && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              {!editable && (
                // Se explica por qué no se puede editar y qué hacer en su
                // lugar, en vez de dejar los campos muertos sin motivo.
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-bold text-slate-600 mb-3">{t.templates.systemLocked}</p>
                  <button
                    onClick={duplicar}
                    disabled={busy}
                    className="w-full bg-accent hover:bg-blue-700 text-white py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50"
                  >
                    {t.templates.duplicate}
                  </button>
                </div>
              )}

              <div>
                <label className={etiqueta}>{t.templates.name}</label>
                <input className={campo} value={draft.name} disabled={!editable}
                  onChange={(e) => set('name', e.target.value)} />
              </div>

              <div>
                <label className={etiqueta}>{t.templates.layout}</label>
                <div className="grid grid-cols-4 gap-2">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l}
                      disabled={!editable}
                      onClick={() => set('layout', l as Layout)}
                      className={`py-2 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all disabled:opacity-40
                        ${draft.layout === l
                          ? 'border-accent bg-blue-50 text-accent'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                    >
                      {t.templates.layouts[l]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={etiqueta}>{t.templates.subject}</label>
                <input className={campo} value={draft.subject} disabled={!editable}
                  onChange={(e) => set('subject', e.target.value)} />
              </div>

              <div>
                <label className={etiqueta}>{t.templates.preheader}</label>
                <input className={campo} value={draft.preheader ?? ''} disabled={!editable}
                  onChange={(e) => set('preheader', e.target.value)} />
                <p className="text-[10px] text-slate-400 font-semibold mt-1">{t.templates.preheaderHelp}</p>
              </div>

              <div>
                <label className={etiqueta}>{t.templates.headline}</label>
                <input className={campo} value={draft.headline ?? ''} disabled={!editable}
                  onChange={(e) => set('headline', e.target.value)} />
              </div>

              <div>
                <label className={etiqueta}>{t.templates.body}</label>
                <textarea className={`${campo} min-h-[160px] leading-relaxed`} value={draft.body}
                  disabled={!editable} onChange={(e) => set('body', e.target.value)} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {VARIABLES.map((v) => (
                    <span key={v}
                      className="text-[10px] font-black text-accent bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-md">
                      {`{{${v}}}`}
                    </span>
                  ))}
                  <span className="text-[10px] font-semibold text-slate-400 self-center ml-1">
                    {t.templates.variablesHelp}
                  </span>
                </div>
              </div>

              <div>
                <label className={etiqueta}>{t.templates.cta}</label>
                <input className={campo} value={draft.cta_label ?? ''} disabled={!editable}
                  onChange={(e) => set('cta_label', e.target.value)} />
              </div>

              <div>
                <label className={etiqueta}>{t.templates.ctaUrl}</label>
                <input className={campo} value={draft.cta_url ?? ''} disabled={!editable}
                  placeholder={t.templates.ctaUrlPlaceholder}
                  onChange={(e) => set('cta_url', e.target.value)} />
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  {draft.cta_url?.trim()
                    ? t.templates.ctaUrlCustom
                    : t.templates.ctaUrlHint}
                </p>
              </div>

              <div>
                <label className={etiqueta}>{t.templates.color}</label>
                <div className="flex flex-wrap gap-2">
                  {COLORES.map((c) => (
                    <button
                      key={c}
                      disabled={!editable}
                      onClick={() => set('accent_color', c)}
                      style={{ background: c }}
                      className={`w-8 h-8 rounded-lg border-2 transition-all disabled:opacity-40
                        ${draft.accent_color === c ? 'border-slate-900 scale-110' : 'border-transparent'}`}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className={etiqueta}>{t.templates.image}</label>
                <input className={campo} value={draft.image_url ?? ''} disabled={!editable}
                  placeholder="https://…" onChange={(e) => set('image_url', e.target.value)} />
              </div>

              {editable && (
                <div className="flex gap-2 pt-2">
                  <button onClick={guardar} disabled={busy}
                    className="flex-1 bg-accent hover:bg-blue-700 text-white py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50">
                    {t.templates.save}
                  </button>
                  <button onClick={borrar} disabled={busy}
                    className="px-4 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50">
                    {t.templates.delete}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Vista previa ──────────────────────────────────────── */}
        <div className="lg:col-span-5 space-y-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
              {t.templates.preview}
            </p>
            <p className="text-sm font-black text-slate-900 truncate">{subject || '—'}</p>
          </div>

          {/* En un iframe con sandbox: el HTML del correo trae sus propios
              estilos y no debe tocar la página del Hub. */}
          <iframe
            title={t.templates.preview}
            srcDoc={html}
            sandbox=""
            className="w-full h-[720px] bg-white border border-slate-200 rounded-2xl"
          />
        </div>
      </div>
    </div>
  );
}

// ── Marca del grupo ──────────────────────────────────────────────────
function BrandPanel({ brand, onSave, busy, t, campo, etiqueta }: any) {
  const [f, setF] = useState<Partial<Brand>>({
    logo_url: brand?.logo_url ?? '',
    accent_color: brand?.accent_color ?? '#1d4ed8',
    from_name: brand?.from_name ?? '',
    signature: brand?.signature ?? '',
    footer_note: brand?.footer_note ?? '',
  });

  useEffect(() => {
    if (brand) setF({
      logo_url: brand.logo_url ?? '', accent_color: brand.accent_color ?? '#1d4ed8',
      from_name: brand.from_name ?? '', signature: brand.signature ?? '',
      footer_note: brand.footer_note ?? '',
    });
  }, [brand]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2">
        <p className="text-xs font-semibold text-slate-500">{t.templates.brandHelp}</p>
      </div>
      <div>
        <label className={etiqueta}>{t.templates.logo}</label>
        <input className={campo} value={f.logo_url ?? ''} placeholder="https://…"
          onChange={(e) => setF({ ...f, logo_url: e.target.value })} />
      </div>
      <div>
        <label className={etiqueta}>{t.templates.fromName}</label>
        <input className={campo} value={f.from_name ?? ''}
          onChange={(e) => setF({ ...f, from_name: e.target.value })} />
        <p className="text-[10px] text-slate-400 font-semibold mt-1">{t.templates.fromNameHelp}</p>
      </div>
      <div>
        <label className={etiqueta}>{t.templates.signature}</label>
        <input className={campo} value={f.signature ?? ''}
          onChange={(e) => setF({ ...f, signature: e.target.value })} />
      </div>
      <div>
        <label className={etiqueta}>{t.templates.footerNote}</label>
        <input className={campo} value={f.footer_note ?? ''}
          onChange={(e) => setF({ ...f, footer_note: e.target.value })} />
      </div>
      <div className="md:col-span-2 flex items-center gap-3">
        <div className="flex gap-2">
          {COLORES.map((c) => (
            <button key={c} onClick={() => setF({ ...f, accent_color: c })} style={{ background: c }}
              className={`w-8 h-8 rounded-lg border-2 transition-all
                ${f.accent_color === c ? 'border-slate-900 scale-110' : 'border-transparent'}`}
              aria-label={c} />
          ))}
        </div>
        <button onClick={() => onSave(f)} disabled={busy}
          className="ml-auto bg-accent hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50">
          {t.templates.save}
        </button>
      </div>
    </div>
  );
}
