import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHubAuth } from '../../contexts/HubAuthContext';
import { supabase } from '../../lib/supabase';
import ReachSelector from '../../components/marketing/ReachSelector';
import DirectPayPanel from '../../components/marketing/DirectPayPanel';
import CampaignPreview from '../../components/marketing/CampaignPreview';
import CampaignStatusBadge from '../../components/marketing/CampaignStatusBadge';
import {
  CreditSummary, EMPTY_SUMMARY, fetchCreditSummary, formatCredits,
} from '../../lib/credits';
import { fetchTemplates, type EmailTemplate } from '../../lib/templates';
import { useHubLang } from '../../contexts/HubLanguageContext';

type TemplateType = 'reengagement' | 'discount' | 'loyalty';
type Step = 1 | 2 | 3;

const TEMPLATE_INFO: Record<TemplateType, {
  icon: string; title: string; desc: string; multiTarget: boolean;
}> = {
  reengagement: {
    icon: 'person_heart',
    title: 'Recuperar clientes',
    desc: 'Va dirigida a quienes cancelaron una cita en los últimos 30 días.',
    multiTarget: true,
  },
  discount: {
    icon: 'local_offer',
    title: 'Campaña de descuento',
    desc: 'Envía un descuento personalizado para que vuelvan a reservar.',
    multiTarget: true,
  },
  loyalty: {
    icon: 'loyalty',
    title: 'Fidelización',
    desc: 'Invita a tus clientes al programa de puntos. Una sucursal cada vez.',
    multiTarget: false,
  },
};

export default function Campaigns() {
  const { user } = useHubAuth();
  const { lang } = useHubLang();

  const [step, setStep] = useState<Step>(1);
  const [showCreator, setShowCreator] = useState(false);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [linkedBusinesses, setLinkedBusinesses] = useState<any[]>([]);
  const [summary, setSummary] = useState<CreditSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [launched, setLaunched] = useState<{ recipients: number; leftover: number } | null>(null);

  // Formulario
  const [template, setTemplate] = useState<TemplateType>('discount');
  // Vacío = la maqueta que trae el tipo de campaña, que es lo que se mandaba
  // cuando aquí no se podía elegir nada.
  const [templateId, setTemplateId] = useState<string>('');
  const [plantillas, setPlantillas] = useState<EmailTemplate[]>([]);
  const [targetAll, setTargetAll] = useState(true);
  const [selectedBizIds, setSelectedBizIds] = useState<string[]>([]);
  const [discountValue, setDiscountValue] = useState(15);
  const [audience, setAudience] = useState(0);
  const [reach, setReach] = useState(0);
  const [countLoading, setCountLoading] = useState(false);

  const loadAll = useCallback(async () => {
    if (!user) return;
    const [{ data: camps }, { data: biz }, sum] = await Promise.all([
      supabase.from('hub_campaigns')
        .select('*, hub_campaign_stats(*)')
        .eq('hub_owner_id', user.id)
        .order('created_at', { ascending: false }),
      supabase.from('hub_connections')
        // Se piden todas las columnas en lugar de nombrar marketing_allowed:
        // si se nombra y la migración del motor de campañas todavía no está
        // aplicada, PostgREST responde error y la página se queda sin
        // sucursales. Pidiendo '*' la columna llega si existe y, si no,
        // el filtro de abajo la trata como permitida.
        .select('*, businesses(name, slug)')
        .eq('hub_owner_id', user.id),
      fetchCreditSummary().catch(() => EMPTY_SUMMARY),
    ]);

    setCampaigns(camps ?? []);
    const allowed = (biz ?? []).filter((b: any) => b.marketing_allowed !== false);
    setLinkedBusinesses(allowed);
    if (allowed.length) setSelectedBizIds(allowed.map((b: any) => b.business_id));
    setSummary(sum);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // El catálogo, en el idioma del Hub. Si falla no se rompe el asistente:
  // sin plantillas se manda la del tipo de campaña, como antes.
  useEffect(() => {
    fetchTemplates(lang).then(setPlantillas).catch(() => setPlantillas([]));
  }, [lang]);

  // Una plantilla que ya no está en el catálogo —cambió el idioma, o se
  // borró— no puede quedarse elegida a la sombra.
  useEffect(() => {
    if (templateId && !plantillas.some((p) => p.id === templateId)) setTemplateId('');
  }, [plantillas, templateId]);

  // Recalcular la audiencia real. Usa la misma función que después decide a
  // quién se envía, así que la cifra mostrada no puede divergir del envío.
  useEffect(() => {
    const ids = targetAll ? linkedBusinesses.map((b) => b.business_id) : selectedBizIds;
    if (!ids.length) { setAudience(0); return; }

    let cancelled = false;
    setCountLoading(true);

    supabase.rpc('get_campaign_recipient_count', {
      p_business_ids: ids,
      p_template_type: template,
      p_days_inactive: 30,
    }).then(({ data }) => {
      if (cancelled) return;
      const count = Number(data ?? 0);
      setAudience(count);
      setReach(Math.min(count, summary.total));
      setCountLoading(false);
    });

    return () => { cancelled = true; };
  }, [template, targetAll, selectedBizIds, linkedBusinesses, summary.total]);

  // Las sucursales a las que va la campaña. Se calcula una sola vez: el
  // envío con saldo y el pago suelto tienen que apuntar a las mismas.
  const bizIds = targetAll ? linkedBusinesses.map((b) => b.business_id) : selectedBizIds;

  // El nombre que aparecerá en el correo. Se coge el de la primera sucursal
  // objetivo: el correo sale a nombre del negocio, no del grupo.
  const nombreNegocio = linkedBusinesses
    .find((b: any) => b.business_id === bizIds[0])?.businesses?.name;

  const resetCreator = () => {
    setShowCreator(false);
    setStep(1);
    setError('');
  };

  const handleLaunch = async () => {
    setSubmitting(true);
    setError('');

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('hub-campaign-enqueue', {
        body: {
          template_id: templateId || null,
          template_type: template,
          target_business_ids: bizIds,
          discount_value: template === 'discount' ? discountValue : null,
          max_recipients: reach,
        },
      });

      if (fnErr && !data) throw new Error('No se pudo contactar con el servicio de campañas.');
      if (!data?.success) throw new Error(data?.error ?? 'No se pudo lanzar la campaña.');

      resetCreator();
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const canLaunch = reach > 0 && reach <= summary.total && !submitting;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-hubText">Campañas de email</h1>
          <p className="text-xs text-hubText3 font-bold mt-0.5 tabular-nums">
            {formatCredits(summary.total)} envíos disponibles
          </p>
        </div>

        {!showCreator && (
          <div className="flex gap-2">
            <Link
              to="/dashboard/marketing/credits"
              className="bg-hubSurface2 hover:bg-hubBorder border border-hubBorder text-hubText px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined notranslate text-[16px]" translate="no">add_card</span>
              Recargar
            </Link>
            <button
              onClick={() => setShowCreator(true)}
              disabled={linkedBusinesses.length === 0}
              className="bg-hubBlue hover:bg-hubBlueHover text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined notranslate text-[16px]" translate="no">add</span>
              Nueva campaña
            </button>
          </div>
        )}
      </div>

      {launched !== null && (
        <div className="bg-hubSuccess/10 border border-hubSuccess/25 text-hubSuccess rounded-2xl px-4 py-3 text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined notranslate text-[18px]" translate="no">check_circle</span>
          Campaña lanzada: {formatCredits(launched.recipients)} correos
          saliendo ahora.
          {launched.leftover > 0
            && ` Te quedan ${formatCredits(launched.leftover)} envíos en el saldo.`}
        </div>
      )}

      {!loading && linkedBusinesses.length === 0 && (
        <div className="bg-hubSurface border border-hubBorder rounded-2xl px-5 py-4">
          <p className="text-sm font-black text-hubText">No hay sucursales disponibles</p>
          <p className="text-xs text-hubText2 mt-1 leading-relaxed">
            Vincula al menos un negocio que haya autorizado el uso comercial de
            su base de clientes desde{' '}
            <Link to="/dashboard/settings" className="text-hubBlue font-bold hover:underline">Ajustes</Link>.
          </p>
        </div>
      )}

      {/* ── Creador ─────────────────────────────────────────────── */}
      {showCreator && (
        <div className="bg-hubSurface border border-hubBlue/30 rounded-3xl p-6 space-y-6 shadow-[0_10px_40px_-14px_rgba(37,99,235,0.25)]">
          <div className="flex items-center gap-2">
            {([1, 2, 3] as Step[]).map((s) => (
              <React.Fragment key={s}>
                <div className={`w-7 h-7 rounded-full text-xs font-black flex items-center justify-center transition-all
                  ${step >= s ? 'bg-hubBlue text-white' : 'bg-hubSurface2 text-hubText3'}`}>
                  {s}
                </div>
                {s < 3 && (
                  <div className={`h-0.5 flex-1 rounded-full transition-all ${step > s ? 'bg-hubBlue' : 'bg-hubBorder'}`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Paso 1 */}
          {step === 1 && (
            <div className="space-y-5">
              <p className="text-sm font-black text-hubText">Elige el tipo de campaña</p>
              <div className="grid grid-cols-1 gap-3">
                {(Object.entries(TEMPLATE_INFO) as [TemplateType, typeof TEMPLATE_INFO.discount][]).map(([key, info]) => (
                  <button
                    key={key}
                    onClick={() => setTemplate(key)}
                    className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all
                      ${template === key
                        ? 'border-hubBlue bg-hubBlue/5'
                        : 'border-hubBorder bg-hubSurface2 hover:border-hubBlue/40'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                      ${template === key ? 'bg-hubBlue text-white' : 'bg-hubSurface text-hubBlue'}`}>
                      <span className="material-symbols-outlined notranslate text-[20px]" translate="no">{info.icon}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-hubText">{info.title}</p>
                      <p className="text-[11px] text-hubText2 mt-0.5 leading-snug">{info.desc}</p>
                    </div>
                    {template === key && (
                      <span className="material-symbols-outlined notranslate text-hubBlue text-[20px] ml-auto shrink-0" translate="no">
                        check_circle
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <p className="text-sm font-black text-hubText">Sucursales objetivo</p>
                <div className="flex gap-2 flex-wrap">
                  {TEMPLATE_INFO[template].multiTarget && (
                    <button
                      onClick={() => setTargetAll(true)}
                      className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all
                        ${targetAll ? 'bg-hubBlue text-white border-transparent' : 'bg-hubSurface border-hubBorder text-hubText2'}`}
                    >
                      Todas las sucursales
                    </button>
                  )}
                  {linkedBusinesses.map((b: any) => (
                    <button
                      key={b.business_id}
                      onClick={() => { setTargetAll(false); setSelectedBizIds([b.business_id]); }}
                      className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all
                        ${!targetAll && selectedBizIds.includes(b.business_id)
                          ? 'bg-hubBlue text-white border-transparent'
                          : 'bg-hubSurface border-hubBorder text-hubText2'}`}
                    >
                      {b.businesses?.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={resetCreator}
                  className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 hover:text-hubText py-3 rounded-xl text-xs font-bold transition-all">
                  Cancelar
                </button>
                <button onClick={() => setStep(2)}
                  className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all">
                  Siguiente
                </button>
              </div>
            </div>
          )}

          {/* Paso 2 */}
          {step === 2 && (
            <div className="space-y-5">
              <p className="text-sm font-black text-hubText">Configura los detalles</p>

              {template === 'discount' ? (
                <div className="space-y-3">
                  <label htmlFor="discount" className="text-xs font-bold text-hubText2">
                    Porcentaje de descuento
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      id="discount"
                      type="number" min={5} max={80}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Math.max(5, Math.min(80, Number(e.target.value))))}
                      className="w-24 bg-hubSurface2 border border-hubBorder rounded-xl px-3 py-2.5 text-2xl font-black text-hubText text-center focus:outline-none focus:border-hubBlue"
                    />
                    <span className="text-2xl font-black text-hubText3">%</span>
                  </div>
                  <input
                    type="range" min={5} max={80} step={5}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    aria-label="Porcentaje de descuento"
                    className="w-full" style={{ accentColor: '#2563eb' }}
                  />
                </div>
              ) : (
                <div className="bg-hubSurface2 border border-hubBorder rounded-2xl p-4">
                  <p className="text-xs text-hubText2 font-bold leading-relaxed">
                    {template === 'reengagement'
                      ? 'El correo irá a los clientes que cancelaron una cita en los últimos 30 días, invitándoles a reservar de nuevo.'
                      : 'El correo incluirá un enlace para unirse al programa de fidelidad de la sucursal elegida.'}
                  </p>
                </div>
              )}

              {/* Qué correo se manda. El tipo de campaña de arriba decide a
                  quién se escribe; esto decide qué lee. Por defecto va la
                  maqueta del tipo, que es lo que salía cuando aquí no se
                  podía elegir: quien no toque nada manda lo mismo de antes. */}
              <div className="space-y-2">
                <label htmlFor="plantilla" className="text-xs font-bold text-hubText2">
                  Plantilla del correo
                </label>
                <select
                  id="plantilla"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full bg-hubSurface2 border border-hubBorder rounded-xl px-3 py-2.5 text-xs font-bold text-hubText focus:outline-none focus:border-hubBlue"
                >
                  <option value="">La estándar de este tipo de campaña</option>
                  {plantillas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.is_system ? '' : ' · mía'}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-hubText3 font-medium leading-snug">
                  Para escribir la tuya, duplica una en{' '}
                  <Link to="/dashboard/marketing/templates" className="text-hubBlue font-bold hover:underline">
                    Plantillas
                  </Link>{' '}
                  y vuelve aquí: aparecerá en esta lista.
                </p>
              </div>

              {/* El correo real, antes de pagar por él. Aquí es donde se
                  detecta el descuento mal puesto: en el paso 3 ya se está
                  decidiendo cuánto gastar, no si el correo está bien. */}
              <CampaignPreview
                campaignType={template}
                templateId={templateId || null}
                discountValue={template === 'discount' ? discountValue : undefined}
                businessName={nombreNegocio}
              />

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(1)}
                  className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 hover:text-hubText py-3 rounded-xl text-xs font-bold transition-all">
                  Atrás
                </button>
                <button onClick={() => setStep(3)}
                  className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all">
                  Siguiente
                </button>
              </div>
            </div>
          )}

          {/* Paso 3 */}
          {step === 3 && (
            <div className="space-y-5">
              <p className="text-sm font-black text-hubText">Alcance y confirmación</p>

              <ReachSelector
                audience={audience}
                balance={summary.total}
                reach={reach}
                onReachChange={setReach}
                loading={countLoading}
              />

              {error && (
                <div className="bg-hubDanger/10 border border-hubDanger/25 text-hubDanger px-4 py-3 rounded-xl text-xs font-bold">
                  {error}
                </div>
              )}

              {/* El saldo no llega a toda la audiencia: se ofrece el otro
                  camino en vez de dejar la pantalla en un callejón sin
                  salida. Comprar un pack sigue estando arriba, en el aviso
                  del selector; aquí se paga solo esta campaña. */}
              {!countLoading && audience > 0 && summary.total < audience && (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-hubBorder" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-hubText3">
                      o
                    </span>
                    <div className="h-px flex-1 bg-hubBorder" />
                  </div>

                  <DirectPayPanel
                    templateId={templateId || null}
                    templateType={template}
                    targetBusinessIds={bizIds}
                    discountValue={template === 'discount' ? discountValue : undefined}
                    audience={audience}
                    onLaunched={(recipients, leftover) => {
                      setLaunched({ recipients, leftover });
                      resetCreator();
                      loadAll();
                    }}
                  />
                </>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep(2)}
                  className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 hover:text-hubText py-3 rounded-xl text-xs font-bold transition-all">
                  Atrás
                </button>
                {/* Sin nada de saldo el botón no puede hacer nada: se
                    esconde para que la única acción visible sea la que sí
                    funciona. */}
                {summary.total > 0 && (
                  <button
                    onClick={handleLaunch}
                    disabled={!canLaunch}
                    className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
                  >
                    {submitting
                      ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : `Enviar a ${formatCredits(reach)} clientes con mi saldo`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Historial ───────────────────────────────────────────── */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-hubBorder/60">
          <p className="text-sm font-black text-hubText">Historial de campañas</p>
        </div>

        {loading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 bg-hubSurface2 rounded-xl" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-symbols-outlined notranslate text-4xl text-hubText3" translate="no">campaign</span>
            <p className="text-sm text-hubText3 font-bold mt-3">Todavía no has lanzado ninguna campaña</p>
          </div>
        ) : (
          <div className="divide-y divide-hubBorder/60">
            {campaigns.map((c) => {
              const stats = c.hub_campaign_stats?.[0];
              return (
                <Link
                  key={c.id}
                  to={`/dashboard/marketing/campaigns/${c.id}`}
                  className="px-5 py-4 flex items-center gap-4 hover:bg-hubSurface2 transition-colors"
                >
                  <div className="w-9 h-9 rounded-xl bg-hubSurface2 flex items-center justify-center text-hubBlue shrink-0">
                    <span className="material-symbols-outlined notranslate text-[18px]" translate="no">
                      {TEMPLATE_INFO[c.template_type as TemplateType]?.icon ?? 'mail'}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-hubText truncate">
                        {c.template_type === 'discount'
                          ? `Descuento ${c.discount_value}%`
                          : TEMPLATE_INFO[c.template_type as TemplateType]?.title ?? c.template_type}
                      </p>
                      <CampaignStatusBadge status={c.status} />
                    </div>
                    <p className="text-[10px] text-hubText3 font-bold mt-0.5 tabular-nums">
                      {new Date(c.created_at).toLocaleDateString('es-ES')}
                      {' · '}{formatCredits(c.recipients_count ?? 0)} destinatarios
                      {stats?.emails_sent > 0 && ` · ${formatCredits(stats.emails_sent)} enviados`}
                      {stats?.open_rate > 0 && ` · ${stats.open_rate}% aperturas`}
                    </p>
                  </div>

                  <span className="material-symbols-outlined notranslate text-hubText3 text-[18px] shrink-0" translate="no">
                    chevron_right
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
