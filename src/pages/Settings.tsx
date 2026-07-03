import React, { useState, useEffect } from 'react';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';
import { supabase } from '../lib/supabase';

interface LinkedBusiness {
  id: string;
  business_id: string;
  linked_at: string;
  businesses: { name: string; slug: string };
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

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setLinking(true);
    setLinkError('');
    setLinkSuccess('');

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
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'fr', label: 'Français', flag: '🇫🇷' },
    { code: 'it', label: 'Italiano', flag: '🇮🇹' },
    { code: 'pt', label: 'Português', flag: '🇵🇹' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fade-in pb-20">
      <header className="flex flex-col gap-2">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">{t.settings.title}</h2>
        <p className="text-sm text-slate-500 font-medium">{t.meta.siteDescription}</p>
      </header>

      {linkSuccess && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 px-6 py-4 rounded-2xl text-sm font-bold flex items-center gap-3 animate-fade-in shadow-sm">
          <span className="material-symbols-outlined notranslate text-[20px]" translate="no">check_circle</span>
          {linkSuccess}
        </div>
      )}

      {/* Linked Businesses Section */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">{t.settings.linkedBusinesses}</h3>
          <button
            onClick={() => { setShowModal(true); setLinkError(''); setTokenInput(''); }}
            className="bg-accent hover:bg-blue-600 text-white px-5 py-2 rounded-xl text-xs font-black tracking-widest uppercase transition-all shadow-md shadow-accent/20 active:scale-95 flex items-center gap-2"
          >
            <span className="material-symbols-outlined notranslate text-[18px]" translate="no">add</span>
            {t.settings.addBusiness}
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {loadingLinked ? (
            <div className="p-10 text-center animate-pulse space-y-4">
              <div className="h-12 bg-slate-50 rounded-xl w-full"></div>
              <div className="h-12 bg-slate-50 rounded-xl w-full"></div>
            </div>
          ) : linked.length === 0 ? (
            <div className="p-12 text-center space-y-4">
              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 mx-auto border border-slate-100">
                <span className="material-symbols-outlined notranslate text-3xl" translate="no">storefront</span>
              </div>
              <p className="text-sm text-slate-400 font-bold">{t.settings.noBusinessesHelper}</p>
            </div>
          ) : (
            linked.map((b) => (
              <div key={b.id} className="px-6 py-5 flex items-center justify-between hover:bg-slate-50 transition-colors group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-sm font-black text-accent shadow-sm group-hover:scale-105 transition-transform">
                    {(b.businesses?.name || 'N')[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-900">{b.businesses?.name}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                      {t.settings.linkedSince} {new Date(b.linked_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setUnlinkId(b.id)}
                  className="text-slate-400 hover:text-red-600 transition-colors p-2 rounded-xl hover:bg-red-50"
                >
                  <span className="material-symbols-outlined notranslate text-[20px]" translate="no">link_off</span>
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Account & Preferences */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Account Info */}
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">{t.settings.account}</h3>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Email</p>
                <p className="text-sm font-bold text-slate-900">{user?.email}</p>
              </div>
              <div className="px-3 py-1 rounded-full bg-blue-50 text-accent text-[10px] font-black uppercase tracking-wider border border-blue-100">
                Owner
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full text-center py-3 rounded-xl text-xs font-black tracking-widest uppercase text-red-600 border border-red-100 hover:bg-red-50 transition-all active:scale-[0.98]"
            >
              {t.settings.logout}
            </button>
          </div>
        </section>

        {/* Preferences */}
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">{t.settings.language}</h3>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 gap-2">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code as any)}
                  className={`
                    flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all
                    ${lang === l.code 
                      ? 'bg-accent text-white shadow-md' 
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-100'}
                  `}
                >
                  <span className="flex items-center gap-3">
                    <span className="text-lg">{l.flag}</span>
                    {l.label}
                  </span>
                  {lang === l.code && <span className="material-symbols-outlined text-[18px]">check_circle</span>}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Modal: Link Business */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fade-in" onClick={() => setShowModal(false)}>
          <div className="bg-white border border-slate-200 rounded-3xl p-8 w-full max-w-md shadow-2xl space-y-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-slate-900 tracking-tight">{t.settings.modalTitle}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <span className="material-symbols-outlined notranslate text-[24px]" translate="no">close</span>
              </button>
            </div>
            
            <p className="text-sm text-slate-500 font-medium leading-relaxed">
              {t.settings.modalDesc}
            </p>

            {linkError && (
              <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-xs font-bold animate-fade-in">
                {linkError}
              </div>
            )}

            <form onSubmit={handleLink} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1">Access Token</label>
                <input
                  autoFocus
                  required
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                  placeholder={t.settings.tokenPlaceholder}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-900 focus:outline-none focus:border-accent/40 focus:bg-white placeholder-slate-300 transition-all"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-6 py-4 rounded-2xl text-xs font-black tracking-widest uppercase text-slate-500 hover:bg-slate-50 transition-all"
                >
                  {t.settings.cancelButton}
                </button>
                <button
                  type="submit"
                  disabled={linking || !tokenInput.trim()}
                  className="flex-[2] bg-accent hover:bg-blue-600 text-white py-4 rounded-2xl text-xs font-black tracking-widest uppercase transition-all shadow-lg shadow-accent/20 active:scale-95 disabled:opacity-50"
                >
                  {linking ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" /> : t.settings.linkButton}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Unlink Confirmation */}
      {unlinkId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fade-in" onClick={() => setUnlinkId(null)}>
          <div className="bg-white border border-slate-200 rounded-3xl p-8 w-full max-w-sm shadow-2xl space-y-6 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center text-red-600 mx-auto border border-red-100">
              <span className="material-symbols-outlined notranslate text-3xl" translate="no">link_off</span>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-black text-slate-900 tracking-tight">{t.settings.unlinkButton}?</h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed">
                {t.settings.unlinkConfirm}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setUnlinkId(null)}
                className="flex-1 px-6 py-4 rounded-2xl text-xs font-black tracking-widest uppercase text-slate-500 hover:bg-slate-50 transition-all"
              >
                {t.settings.cancelButton}
              </button>
              <button
                onClick={() => handleUnlink(unlinkId)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-4 rounded-2xl text-xs font-black tracking-widest uppercase transition-all shadow-lg shadow-red-600/20 active:scale-95"
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
