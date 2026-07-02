import React, { useState, useEffect } from 'react';
import { useHubAuth } from '../../contexts/HubAuthContext';
import { supabase } from '../../lib/supabase';
import BudgetSlider from '../../components/marketing/BudgetSlider';
import CampaignStatusBadge from '../../components/marketing/CampaignStatusBadge';
import PaymentRequiredBanner from '../../components/marketing/PaymentRequiredBanner';

type TemplateType = 'reengagement' | 'discount' | 'loyalty';
type Step = 1 | 2 | 3;

const TEMPLATE_INFO: Record<TemplateType, { icon: string; title: string; desc: string; multiTarget: boolean }> = {
  reengagement: { icon: 'person_heart', title: 'Recuperar clientes', desc: 'Dirige la campaña a clientes que cancelaron en los últimos 30 días.', multiTarget: true },
  discount:     { icon: 'local_offer',  title: 'Campaña de descuento', desc: 'Envía un código de descuento personalizado para que reserven.', multiTarget: true },
  loyalty:      { icon: 'loyalty',      title: 'Fidelización', desc: 'Invita a tus clientes a unirse al programa de puntos. Solo por sucursal.', multiTarget: false },
};

export default function Campaigns() {
  const { user } = useHubAuth();
  const [step, setStep] = useState<Step>(1);
  const [showCreator, setShowCreator] = useState(false);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [linkedBusinesses, setLinkedBusinesses] = useState<any[]>([]);
  const [billing, setBilling] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [template, setTemplate] = useState<TemplateType>('discount');
  const [targetAll, setTargetAll] = useState(true);
  const [selectedBizIds, setSelectedBizIds] = useState<string[]>([]);
  const [discountValue, setDiscountValue] = useState(15);
  const [budget, setBudget] = useState(25);
  const [recipientCount, setRecipientCount] = useState(0);
  const [countLoading, setCountLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const [{ data: bil }, { data: camps }, { data: biz }] = await Promise.all([
        supabase.from('hub_billing').select('*').eq('hub_owner_id', user.id).maybeSingle(),
        supabase.from('hub_campaigns').select('*, hub_campaign_stats(*)').eq('hub_owner_id', user.id).order('created_at', { ascending: false }),
        supabase.from('hub_connections').select('business_id, businesses(name, slug)').eq('hub_owner_id', user.id),
      ]);
      setBilling(bil);
      setCampaigns(camps ?? []);
      setLinkedBusinesses(biz ?? []);
      if (biz?.length) setSelectedBizIds(biz.map((b: any) => b.business_id));
      setLoading(false);
    };
    fetch();
  }, [user]);

  // Recalculate recipient count on changes
  useEffect(() => {
    const ids = targetAll ? linkedBusinesses.map(b => b.business_id) : selectedBizIds;
    if (!ids.length) return;
    setCountLoading(true);
    supabase.rpc('get_campaign_recipient_count', {
      p_business_ids: ids,
      p_template_type: template,
      p_days_inactive: 30,
    }).then(({ data }) => {
      setRecipientCount(data ?? 0);
      setCountLoading(false);
    });
  }, [template, targetAll, selectedBizIds, linkedBusinesses]);

  const hasBilling = billing?.status === 'active';

  const handleLaunch = async () => {
    if (!hasBilling) return;
    setSubmitting(true);
    setError('');
    try {
      const bizIds = targetAll ? linkedBusinesses.map(b => b.business_id) : selectedBizIds;
      const estimatedRecipients = Math.min(Math.floor(budget / 0.01), recipientCount);

      const { data, error: fnErr } = await supabase.functions.invoke('hub-create-campaign-payment', {
        body: {
          template_type: template,
          target_business_ids: bizIds,
          budget_eur: budget,
          recipients_count: estimatedRecipients,
          discount_value: template === 'discount' ? discountValue : null,
        },
      });

      if (fnErr || !data?.success) throw new Error(data?.error ?? fnErr?.message ?? 'Error al procesar el pago');

      // Trigger send
      await supabase.functions.invoke('hub-send-campaign', { body: { campaign_id: data.campaign_id } });

      // Refresh
      const { data: camps } = await supabase.from('hub_campaigns').select('*, hub_campaign_stats(*)').eq('hub_owner_id', user!.id).order('created_at', { ascending: false });
      setCampaigns(camps ?? []);
      setShowCreator(false);
      setStep(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black text-white">Campañas de Email</h1>
        {!showCreator && hasBilling && (
          <button onClick={() => setShowCreator(true)} className="bg-hubBlue hover:bg-hubBlueHover text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2">
            <span className="material-symbols-outlined notranslate text-[16px]" translate="no">add</span>
            Nueva campaña
          </button>
        )}
      </div>

      {!hasBilling && <PaymentRequiredBanner activeCampaigns={campaigns.filter(c => c.status === 'paused_no_billing').length} />}

      {/* ── Campaign Creator ───────────────────────────────────── */}
      {showCreator && hasBilling && (
        <div className="bg-hubSurface border border-hubBlue/30 rounded-3xl p-6 space-y-6">
          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {([1, 2, 3] as Step[]).map((s) => (
              <React.Fragment key={s}>
                <div className={`w-7 h-7 rounded-full text-xs font-black flex items-center justify-center transition-all
                  ${step >= s ? 'bg-hubBlue text-white' : 'bg-hubSurface2 text-hubText3'}`}>
                  {s}
                </div>
                {s < 3 && <div className={`h-0.5 flex-1 rounded-full transition-all ${step > s ? 'bg-hubBlue' : 'bg-hubBorder'}`} />}
              </React.Fragment>
            ))}
          </div>

          {/* Step 1: Template + Target */}
          {step === 1 && (
            <div className="space-y-5">
              <p className="text-sm font-black text-white">Elige el tipo de campaña</p>
              <div className="grid grid-cols-1 gap-3">
                {(Object.entries(TEMPLATE_INFO) as [TemplateType, typeof TEMPLATE_INFO.discount][]).map(([key, info]) => (
                  <button key={key} onClick={() => setTemplate(key)}
                    className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all
                      ${template === key ? 'border-hubBlue/60 bg-hubBlueMuted' : 'border-hubBorder bg-hubSurface2 hover:border-hubBlue/30'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${template === key ? 'bg-hubBlue text-white' : 'bg-hubSurface text-hubBlueText'}`}>
                      <span className="material-symbols-outlined notranslate text-[20px]" translate="no">{info.icon}</span>
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">{info.title}</p>
                      <p className="text-[11px] text-hubText2 mt-0.5">{info.desc}</p>
                    </div>
                    {template === key && <span className="material-symbols-outlined notranslate text-hubBlue text-[20px] ml-auto" translate="no">check_circle</span>}
                  </button>
                ))}
              </div>

              {/* Target selection */}
              <div className="space-y-3">
                <p className="text-sm font-black text-white">Sucursales objetivo</p>
                {TEMPLATE_INFO[template].multiTarget ? (
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setTargetAll(true)}
                      className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all ${targetAll ? 'bg-hubBlue text-white border-transparent' : 'bg-hubSurface border-hubBorder text-hubText2'}`}>
                      Todas las sucursales
                    </button>
                    {linkedBusinesses.map((b: any) => (
                      <button key={b.business_id}
                        onClick={() => { setTargetAll(false); setSelectedBizIds([b.business_id]); }}
                        className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all
                          ${!targetAll && selectedBizIds.includes(b.business_id) ? 'bg-hubBlue text-white border-transparent' : 'bg-hubSurface border-hubBorder text-hubText2'}`}>
                        {b.businesses?.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {linkedBusinesses.map((b: any) => (
                      <button key={b.business_id}
                        onClick={() => setSelectedBizIds([b.business_id])}
                        className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all
                          ${selectedBizIds.includes(b.business_id) && !targetAll ? 'bg-hubBlue text-white border-transparent' : 'bg-hubSurface border-hubBorder text-hubText2'}`}>
                        {b.businesses?.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowCreator(false)} className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 py-3 rounded-xl text-xs font-bold transition-all hover:text-white">Cancelar</button>
                <button onClick={() => setStep(2)} className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all">Siguiente →</button>
              </div>
            </div>
          )}

          {/* Step 2: Variables */}
          {step === 2 && (
            <div className="space-y-5">
              <p className="text-sm font-black text-white">Configura los detalles</p>
              {template === 'discount' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-hubText2">Porcentaje de descuento</label>
                  <div className="flex items-center gap-3">
                    <input type="number" min={5} max={80} value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))}
                      className="w-24 bg-hubSurface2 border border-hubBorder rounded-xl px-3 py-2.5 text-2xl font-black text-white text-center focus:outline-none focus:border-hubBlue/60" />
                    <span className="text-2xl font-black text-hubText2">%</span>
                  </div>
                  <input type="range" min={5} max={80} step={5} value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))}
                    className="w-full" style={{ accentColor: '#2563eb' }} />
                </div>
              )}
              {template !== 'discount' && (
                <div className="bg-hubSurface2 border border-hubBorder rounded-2xl p-4">
                  <p className="text-xs text-hubText2 font-bold">
                    {template === 'reengagement'
                      ? '✅ Los emails se enviarán a clientes con cancelaciones en los últimos 30 días, invitándolos a volver.'
                      : '✅ Los emails incluirán un enlace para unirse al programa de fidelidad de la sucursal seleccionada.'}
                  </p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(1)} className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 py-3 rounded-xl text-xs font-bold hover:text-white transition-all">← Atrás</button>
                <button onClick={() => setStep(3)} className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all">Siguiente →</button>
              </div>
            </div>
          )}

          {/* Step 3: Budget + Pay */}
          {step === 3 && (
            <div className="space-y-5">
              <p className="text-sm font-black text-white">Presupuesto y pago</p>
              <BudgetSlider budget={budget} onBudgetChange={setBudget} availableClients={recipientCount} loading={countLoading} />
              {error && (
                <div className="bg-hubDanger/10 border border-hubDanger/20 text-hubDanger px-4 py-3 rounded-xl text-xs font-bold">{error}</div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 py-3 rounded-xl text-xs font-bold hover:text-white transition-all">← Atrás</button>
                <button onClick={handleLaunch} disabled={submitting || recipientCount === 0}
                  className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2">
                  {submitting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : `Pagar €${budget.toFixed(2)} y lanzar →`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Campaign List ──────────────────────────────────────── */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-hubBorder/40">
          <p className="text-sm font-black text-white">Historial de campañas</p>
        </div>
        {loading ? (
          <div className="p-5 space-y-3 animate-pulse">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 bg-hubSurface2 rounded-xl" />)}</div>
        ) : campaigns.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-symbols-outlined notranslate text-4xl text-hubText3" translate="no">campaign</span>
            <p className="text-sm text-hubText3 font-bold mt-3">No hay campañas todavía</p>
          </div>
        ) : (
          <div className="divide-y divide-hubBorder/20">
            {campaigns.map(c => {
              const stats = c.hub_campaign_stats?.[0];
              return (
                <div key={c.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-xl bg-hubSurface2 flex items-center justify-center text-hubBlueText shrink-0">
                    <span className="material-symbols-outlined notranslate text-[18px]" translate="no">
                      {c.template_type === 'reengagement' ? 'person_heart' : c.template_type === 'discount' ? 'local_offer' : 'loyalty'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-white truncate">
                        {c.template_type === 'reengagement' ? 'Recuperar clientes' : c.template_type === 'discount' ? `Descuento ${c.discount_value}%` : 'Fidelización'}
                      </p>
                      <CampaignStatusBadge status={c.status} />
                    </div>
                    <p className="text-[10px] text-hubText3 font-bold mt-0.5">
                      {new Date(c.created_at).toLocaleDateString()} · {c.recipients_count} destinatarios · €{Number(c.budget_eur).toFixed(2)}
                      {stats?.emails_sent > 0 && ` · ${stats.emails_sent} enviados`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
