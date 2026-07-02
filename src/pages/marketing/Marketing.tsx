import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useHubAuth } from '../../contexts/HubAuthContext';
import { useHubLang } from '../../contexts/HubLanguageContext';
import { supabase } from '../../lib/supabase';
import PaymentRequiredBanner from '../../components/marketing/PaymentRequiredBanner';
import CampaignStatusBadge from '../../components/marketing/CampaignStatusBadge';

const TEMPLATE_ICONS: Record<string, string> = {
  reengagement: 'person_heart',
  discount:     'local_offer',
  loyalty:      'loyalty',
};

export default function Marketing() {
  const { user } = useHubAuth();
  const { t } = useHubLang();
  const [billing, setBilling] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const [{ data: bil }, { data: camps }] = await Promise.all([
        supabase.from('hub_billing').select('*').eq('hub_owner_id', user.id).maybeSingle(),
        supabase.from('hub_campaigns').select('*, hub_campaign_stats(*)').eq('hub_owner_id', user.id).order('created_at', { ascending: false }).limit(5),
      ]);
      setBilling(bil);
      setCampaigns(camps ?? []);
      setLoading(false);
    };
    fetch();
  }, [user]);

  const hasBilling = billing?.status === 'active';
  const pausedCount = campaigns.filter(c => c.status === 'paused_no_billing').length;

  const stats = [
    { label: t.marketing.sentCampaigns, value: campaigns.filter(c => c.status === 'completed').length, icon: 'send' },
    { label: t.marketing.totalEmailsSent, value: campaigns.reduce((s, c) => s + (c.hub_campaign_stats?.[0]?.emails_sent ?? 0), 0), icon: 'mail' },
    { label: t.marketing.budgetInvested, value: `€${campaigns.filter(c => c.status === 'completed').reduce((s, c) => s + Number(c.budget_eur), 0).toFixed(0)}`, icon: 'payments' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-black text-white">{t.marketing.title}</h1>
          <p className="text-xs text-hubText3 font-bold mt-0.5">{t.marketing.subtitle}</p>
        </div>
        <Link
          to="/dashboard/marketing/campaigns"
          className="bg-hubBlue hover:bg-hubBlueHover text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-start"
        >
          <span className="material-symbols-outlined notranslate text-[16px]" translate="no">add</span>
          {t.marketing.newCampaign}
        </Link>
      </div>

      {!hasBilling && <PaymentRequiredBanner activeCampaigns={pausedCount} />}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="bg-hubSurface border border-hubBorder rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-hubText3">{s.label}</p>
              <span className="material-symbols-outlined notranslate text-hubBlueText text-[18px]" translate="no">{s.icon}</span>
            </div>
            {loading ? <div className="h-6 w-16 bg-hubSurface2 rounded animate-pulse" /> : (
              <p className="text-xl font-black text-white">{s.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Sub-navigation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { to: '/dashboard/marketing/campaigns', icon: 'campaign', label: t.sidebar.campaigns, desc: t.marketing.campaigns },
          { to: '/dashboard/marketing/billing',   icon: 'credit_card', label: t.sidebar.billing, desc: t.marketing.billing },
        ].map(item => (
          <Link key={item.to} to={item.to}
            className="bg-hubSurface border border-hubBorder hover:border-hubBlue/40 rounded-2xl p-4 flex flex-col gap-3 transition-all group">
            <div className="w-10 h-10 rounded-xl bg-hubSurface2 group-hover:bg-hubBlueMuted flex items-center justify-center text-hubBlueText transition-colors">
              <span className="material-symbols-outlined notranslate text-[20px]" translate="no">{item.icon}</span>
            </div>
            <div>
              <p className="text-sm font-black text-white">{item.label}</p>
              <p className="text-[10px] text-hubText3 font-bold">{item.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Campaigns */}
      {campaigns.length > 0 && (
        <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-hubBorder/40 flex items-center justify-between gap-2">
            <p className="text-sm font-black text-white">{t.marketing.recentCampaigns}</p>
            <Link to="/dashboard/marketing/campaigns" className="text-xs text-hubBlueText font-bold hover:underline whitespace-nowrap">{t.marketing.viewAll}</Link>
          </div>
          <div className="divide-y divide-hubBorder/20">
            {campaigns.slice(0, 4).map(c => {
              const templateLabel = t.marketing[c.template_type as keyof typeof t.marketing] || c.template_type;
              return (
              <div key={c.id} className="px-3 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="w-8 h-8 rounded-xl bg-hubSurface2 flex items-center justify-center text-hubBlueText shrink-0">
                  <span className="material-symbols-outlined notranslate text-[16px]" translate="no">{TEMPLATE_ICONS[c.template_type] ?? 'mail'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{templateLabel}</p>
                  <p className="text-[10px] text-hubText3 font-bold">{new Date(c.created_at).toLocaleDateString()} · {c.recipients_count} destinatarios · €{c.budget_eur}</p>
                </div>
                <CampaignStatusBadge status={c.status} />
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
