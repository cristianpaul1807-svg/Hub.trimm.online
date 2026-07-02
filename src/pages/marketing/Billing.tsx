import React, { useState, useEffect } from 'react';
import { useHubAuth } from '../../contexts/HubAuthContext';
import { supabase } from '../../lib/supabase';

const CARD_BRANDS: Record<string, string> = {
  visa: '💳 Visa',
  mastercard: '💳 Mastercard',
  amex: '💳 American Express',
};

export default function Billing() {
  const { user } = useHubAuth();
  const [billing, setBilling] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [setupError, setSetupError] = useState('');

  const fetchBilling = async () => {
    if (!user) return;
    const [{ data: bil }, { data: camps }] = await Promise.all([
      supabase.from('hub_billing').select('*').eq('hub_owner_id', user.id).maybeSingle(),
      supabase.from('hub_campaigns').select('id, status, budget_eur, created_at, template_type').eq('hub_owner_id', user.id).order('created_at', { ascending: false }).limit(10),
    ]);
    setBilling(bil);
    setCampaigns(camps ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchBilling(); }, [user]);

  const handleConnect = async () => {
    setConnecting(true);
    setSetupError('');
    try {
      const { data, error } = await supabase.functions.invoke('hub-create-setup-intent');
      if (error || !data?.client_secret) throw new Error('No se pudo iniciar la conexión de pago.');

      // Redirect to Stripe Hosted Page (simplest for now — no Stripe.js required on frontend)
      // In production, use Stripe Elements here with the client_secret
      alert(`[DEMO] SetupIntent creado correctamente. client_secret: ${data.client_secret}\n\nEn producción, aquí se abrirá el formulario de tarjeta con Stripe Elements.`);
    } catch (err: any) {
      setSetupError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await supabase.functions.invoke('hub-disconnect-billing');
      setShowDisconnectModal(false);
      await fetchBilling();
    } catch (err) {
      console.error(err);
    } finally {
      setDisconnecting(false);
    }
  };

  const hasBilling = billing?.status === 'active';
  const activeCampaigns = campaigns.filter(c => ['draft', 'paid', 'sending'].includes(c.status));
  const completedCampaigns = campaigns.filter(c => c.status === 'completed');
  const totalSpent = completedCampaigns.reduce((s, c) => s + Number(c.budget_eur), 0);

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-lg font-black text-white">Facturación</h1>

      {/* Payment Method Card */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-hubBorder/40">
          <p className="text-sm font-black text-white">Método de pago</p>
        </div>
        {loading ? (
          <div className="p-5 animate-pulse"><div className="h-14 bg-hubSurface2 rounded-xl" /></div>
        ) : hasBilling ? (
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-10 rounded-xl bg-hubBlueMuted border border-hubBlue/20 flex items-center justify-center text-sm font-black text-hubBlueText">
                {CARD_BRANDS[billing.card_brand]?.split(' ')[0] ?? '💳'}
              </div>
              <div>
                <p className="text-sm font-black text-white">{CARD_BRANDS[billing.card_brand] ?? 'Tarjeta'} •••• {billing.card_last4}</p>
                <p className="text-[10px] text-hubText3 font-bold">Expira {billing.card_exp_month}/{billing.card_exp_year}</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-hubSuccess" />
                <span className="text-[10px] text-hubSuccess font-black">Activa</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex-1 bg-hubSurface2 hover:bg-hubBorder border border-hubBorder text-hubText2 hover:text-white py-2.5 rounded-xl text-xs font-bold transition-all"
              >
                ✏️ Cambiar tarjeta
              </button>
              <button
                onClick={() => setShowDisconnectModal(true)}
                className="flex-1 bg-hubDanger/10 hover:bg-hubDanger/20 border border-hubDanger/30 text-hubDanger py-2.5 rounded-xl text-xs font-bold transition-all"
              >
                ✂️ Desconectar
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 bg-hubSurface2 border border-hubBorder rounded-2xl flex items-center justify-center text-hubText3 mx-auto">
                <span className="material-symbols-outlined notranslate text-2xl" translate="no">credit_card</span>
              </div>
              <p className="text-sm font-bold text-hubText2">Sin método de pago activo</p>
              <p className="text-xs text-hubText3">Conecta tu tarjeta para poder crear y pagar campañas de email marketing.</p>
            </div>
            {setupError && <p className="text-xs text-hubDanger font-bold text-center">{setupError}</p>}
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full bg-hubBlue hover:bg-hubBlueHover text-white py-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {connecting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : '💳 Conectar tarjeta de pago'}
            </button>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {hasBilling && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-hubSurface border border-hubBorder rounded-2xl p-4 space-y-1">
            <p className="text-[10px] text-hubText3 font-black uppercase tracking-widest">Inversión total</p>
            <p className="text-xl font-black text-white">€{totalSpent.toFixed(2)}</p>
          </div>
          <div className="bg-hubSurface border border-hubBorder rounded-2xl p-4 space-y-1">
            <p className="text-[10px] text-hubText3 font-black uppercase tracking-widest">Campañas completadas</p>
            <p className="text-xl font-black text-white">{completedCampaigns.length}</p>
          </div>
        </div>
      )}

      {/* Invoice history */}
      {completedCampaigns.length > 0 && (
        <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-hubBorder/40">
            <p className="text-sm font-black text-white">Historial de pagos</p>
          </div>
          <div className="divide-y divide-hubBorder/20">
            {completedCampaigns.map(c => (
              <div key={c.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-white">
                    {c.template_type === 'discount' ? 'Campaña descuento' : c.template_type === 'reengagement' ? 'Recuperar clientes' : 'Fidelización'}
                  </p>
                  <p className="text-[10px] text-hubText3 font-bold">{new Date(c.created_at).toLocaleDateString()}</p>
                </div>
                <span className="text-sm font-black text-white">€{Number(c.budget_eur).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Modal */}
      {showDisconnectModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowDisconnectModal(false)}>
          <div className="bg-hubSurface border border-hubBorder rounded-3xl p-6 w-full max-w-sm shadow-2xl shadow-black/80 space-y-5" onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-2xl bg-hubDanger/10 border border-hubDanger/20 flex items-center justify-center text-hubDanger mx-auto">
              <span className="material-symbols-outlined notranslate text-2xl" translate="no">credit_card_off</span>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-base font-black text-white">¿Desconectar método de pago?</h3>
              {activeCampaigns.length > 0 ? (
                <p className="text-xs text-amber-400 leading-relaxed font-bold">
                  ⚠️ Tienes {activeCampaigns.length} campaña{activeCampaigns.length > 1 ? 's' : ''} activa{activeCampaigns.length > 1 ? 's' : ''}. Si continúas, {activeCampaigns.length > 1 ? 'todas se pausarán' : 'se pausará'} hasta que conectes un nuevo método de pago.
                </p>
              ) : (
                <p className="text-xs text-hubText2 leading-relaxed">No tienes campañas activas. Podrás reconectar una nueva tarjeta en cualquier momento.</p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDisconnectModal(false)} className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 hover:text-white py-3 rounded-2xl text-xs font-bold transition-all">
                Mantener activo
              </button>
              <button onClick={handleDisconnect} disabled={disconnecting}
                className="flex-1 bg-hubDanger hover:bg-red-700 text-white py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50">
                {disconnecting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" /> : 'Sí, desconectar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
