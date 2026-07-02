import React, { useState, useEffect } from 'react';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';
import { supabase } from '../lib/supabase';

interface LinkedBusiness {
  id: string;
  business_id: string;
  linked_at: string;
  businesses: { name: string; slug: string };
  staff_count?: number;
}

export default function Settings() {
  const { user, logout } = useHubAuth();
  const { t, lang, setLang } = useHubLang();
  const [linked, setLinked] = useState<LinkedBusiness[]>([]);
  const [loadingLinked, setLoadingLinked] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkSuccess, setLinkSuccess] = useState('');
  const [unlinkId, setUnlinkId] = useState<string | null>(null);

  const fetchLinked = async () => {
    if (!user) return;
    setLoadingLinked(true);
    const { data } = await supabase
      .from('hub_connections')
      .select('id, business_id, linked_at, businesses(name, slug)')
      .eq('hub_owner_id', user.id)
      .order('linked_at', { ascending: false });
    if (data) setLinked(data as any);
    setLoadingLinked(false);
  };

  useEffect(() => { fetchLinked(); }, [user]);

  const handleLink = async () => {
    if (!tokenInput.trim()) return;
    setLinking(true);
    setLinkError('');
    setLinkSuccess('');

    // Format token: user types TRIMM-XXXX-XXXX-XXXX, we extract the raw hex
    const raw = tokenInput.replace(/TRIMM-/i, '').replace(/-/g, '').toLowerCase();

    const { data, error } = await supabase.rpc('claim_hub_token', { p_token: raw });

    if (error || !data?.success) {
      const msg = data?.error || error?.message || t.errors.generic;
      if (msg.includes('ya está vinculado')) setLinkError(t.settings.linkErrorAlready);
      else setLinkError(t.settings.linkErrorInvalid);
    } else {
      setLinkSuccess(t.settings.linkSuccess);
      setTokenInput('');
      setShowModal(false);
      setTimeout(() => setLinkSuccess(''), 4000);
      await fetchLinked();
    }
    setLinking(false);
  };

  const handleUnlink = async (connId: string) => {
    const { error } = await supabase
      .from('hub_connections')
      .delete()
      .eq('id', connId)
      .eq('hub_owner_id', user?.id);
    if (!error) { setUnlinkId(null); await fetchLinked(); }
  };

  const LANGS = [
    { code: 'es', label: '🇪🇸 Español' },
    { code: 'en', label: '🇺🇸 English' },
    { code: 'fr', label: '🇫🇷 Français' },
    { code: 'it', label: '🇮🇹 Italiano' },
    { code: 'pt', label: '🇵🇹 Português' },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-lg font-black text-white">{t.settings.title}</h1>

      {/* Success Toast */}
      {linkSuccess && (
        <div className="bg-hubSuccess/10 border border-hubSuccess/20 text-hubSuccess px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2">
          <span className="material-symbols-outlined notranslate text-[18px]" translate="no">check_circle</span>
          {linkSuccess}
        </div>
      )}

      {/* Linked Businesses */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-hubBorder/40">
          <p className="text-sm font-black text-white">{t.settings.linkedBusinesses}</p>
          <button
            onClick={() => { setShowModal(true); setLinkError(''); setTokenInput(''); }}
            className="bg-hubBlue hover:bg-hubBlueHover text-white px-4 py-2 rounded-xl text-xs font-black tracking-wider uppercase transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined notranslate text-[16px]" translate="no">add</span>
            {t.settings.addBusiness}
          </button>
        </div>

        {loadingLinked ? (
          <div className="p-5 space-y-3 animate-pulse">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-16 bg-hubSurface2 rounded-xl" />)}
          </div>
        ) : linked.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-hubText3 font-bold">{t.errors.noData}</p>
            <p className="text-xs text-hubText3 mt-1">{t.settings.noBusinessesHelper}</p>
          </div>
        ) : (
          <div className="divide-y divide-hubBorder/20">
            {linked.map((b) => (
              <div key={b.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-10 h-10 rounded-2xl bg-hubBlueMuted border border-hubBlue/20 flex items-center justify-center text-sm font-black text-hubBlueText shrink-0">
                  {(b.businesses?.name || 'N')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{b.businesses?.name}</p>
                  <p className="text-[10px] text-hubText3 font-bold mt-0.5">
                    {t.settings.linkedSince} {new Date(b.linked_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => setUnlinkId(b.id)}
                  className="text-hubText3 hover:text-hubDanger transition-colors px-2 py-1 rounded-lg hover:bg-red-900/20 text-xs font-bold flex items-center gap-1"
                >
                  <span className="material-symbols-outlined notranslate text-[16px]" translate="no">link_off</span>
                  {t.settings.unlinkButton}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Account Settings */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-hubBorder/40">
          <p className="text-sm font-black text-white">{t.settings.account}</p>
        </div>
        <div className="divide-y divide-hubBorder/20">
          <div className="px-5 py-4 flex items-center justify-between">
            <p className="text-xs font-bold text-hubText2">Email</p>
            <p className="text-xs font-black text-white">{user?.email}</p>
          </div>
          <div className="px-5 py-4 flex items-center justify-between">
            <p className="text-xs font-bold text-hubText2">{t.settings.language}</p>
            <select
              value={lang}
              onChange={e => setLang(e.target.value as any)}
              className="bg-hubSurface2 border border-hubBorder rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-hubBlue/40"
            >
              {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div className="px-5 py-4">
            <button
              onClick={() => logout()}
              className="text-hubDanger hover:bg-red-900/20 px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2"
            >
              <span className="material-symbols-outlined notranslate text-[16px]" translate="no">logout</span>
              {t.settings.logout}
            </button>
          </div>
        </div>
      </div>

      {/* Notifications (Coming Soon) */}
      <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden opacity-50">
        <div className="px-5 py-4 border-b border-hubBorder/40 flex items-center justify-between">
          <p className="text-sm font-black text-white">{t.settings.notifications}</p>
          <span className="text-[9px] font-black uppercase tracking-widest text-hubText3 bg-hubSurface2 border border-hubBorder px-2 py-1 rounded-full">{t.settings.comingSoon}</span>
        </div>
        <div className="divide-y divide-hubBorder/20">
          {[t.settings.notifWeekly, t.settings.notifAlerts].map((n, i) => (
            <div key={i} className="px-5 py-4 flex items-center justify-between">
              <p className="text-xs font-bold text-hubText2">{n}</p>
              <div className="w-8 h-4 bg-hubSurface2 border border-hubBorder rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Link Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-hubSurface border border-hubBorder rounded-3xl p-6 w-full max-w-sm shadow-2xl shadow-black/80 space-y-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-black text-white">{t.settings.modalTitle}</h3>
                <p className="text-xs text-hubText2 mt-1 leading-relaxed">{t.settings.modalDesc}</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-hubText3 hover:text-white transition-colors ml-3 mt-0.5">
                <span className="material-symbols-outlined notranslate text-[20px]" translate="no">close</span>
              </button>
            </div>

            {linkError && (
              <div className="bg-hubDanger/10 border border-hubDanger/20 text-hubDanger px-3 py-2.5 rounded-xl text-xs font-bold">
                {linkError}
              </div>
            )}

            <input
              type="text"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value.toUpperCase())}
              placeholder={t.settings.tokenPlaceholder}
              className="w-full bg-hubSurface2 border border-hubBorder rounded-2xl px-4 py-3 text-sm text-white font-black tracking-widest focus:outline-none focus:border-hubBlue/60 placeholder-hubText3 transition-colors text-center"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 bg-hubSurface2 hover:bg-hubBorder text-hubText2 py-3 rounded-2xl text-xs font-bold transition-all border border-hubBorder"
              >
                {t.settings.cancelButton}
              </button>
              <button
                onClick={handleLink}
                disabled={linking || !tokenInput.trim()}
                className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                {linking ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
                ) : t.settings.linkButton}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlink Confirm Modal */}
      {unlinkId && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setUnlinkId(null)}>
          <div className="bg-hubSurface border border-hubBorder rounded-3xl p-6 w-full max-w-sm shadow-2xl shadow-black/80 space-y-5" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-2xl bg-hubDanger/10 border border-hubDanger/20 flex items-center justify-center text-hubDanger mx-auto">
              <span className="material-symbols-outlined notranslate text-xl" translate="no">link_off</span>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-base font-black text-white">{t.settings.unlinkButton}</h3>
              <p className="text-xs text-hubText2 leading-relaxed">{t.settings.unlinkConfirm}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setUnlinkId(null)} className="flex-1 bg-hubSurface2 hover:bg-hubBorder text-hubText2 py-3 rounded-2xl text-xs font-bold transition-all border border-hubBorder">
                {t.settings.cancelButton}
              </button>
              <button
                onClick={() => handleUnlink(unlinkId)}
                className="flex-1 bg-hubDanger hover:bg-red-700 text-white py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all"
              >
                {t.settings.unlinkButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
