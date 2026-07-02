import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';
import { supabase } from '../lib/supabase';

interface TopBarProps {
  onMenuToggle: () => void;
  selectedBusinessId: string | null;
  onBusinessSelect: (id: string | null) => void;
}

interface LinkedBusiness {
  business_id: string;
  businesses: { name: string; slug: string };
}

const BREADCRUMBS: Record<string, string[]> = {
  '/dashboard': ['Métricas'],
  '/dashboard/kpis': ['KPIs'],
  '/dashboard/workers': ['Trabajadores'],
  '/dashboard/comparator': ['Comparador'],
  '/dashboard/settings': ['Ajustes'],
};

const LANG_FLAGS: Record<string, string> = {
  es: '🇪🇸', en: '🇺🇸', fr: '🇫🇷', it: '🇮🇹', pt: '🇵🇹'
};

export default function TopBar({ onMenuToggle, selectedBusinessId, onBusinessSelect }: TopBarProps) {
  const location = useLocation();
  const { user, logout } = useHubAuth();
  const { t, lang, setLang } = useHubLang();

  const [linkedBusinesses, setLinkedBusinesses] = useState<LinkedBusiness[]>([]);
  const [businessDropOpen, setBusinessDropOpen] = useState(false);
  const [userDropOpen, setUserDropOpen] = useState(false);
  const [langDropOpen, setLangDropOpen] = useState(false);

  const businessRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const fetchLinked = async () => {
      const { data } = await supabase
        .from('hub_connections')
        .select('business_id, businesses(name, slug)')
        .eq('hub_owner_id', user.id);
      if (data) setLinkedBusinesses(data as any);
    };
    fetchLinked();
  }, [user]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (businessRef.current && !businessRef.current.contains(e.target as Node)) setBusinessDropOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserDropOpen(false);
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangDropOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedBusiness = linkedBusinesses.find(b => b.business_id === selectedBusinessId);
  const breadcrumb = BREADCRUMBS[location.pathname] || ['Hub'];
  const initials = (user?.email?.[0] || 'H').toUpperCase();

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 sticky top-0 z-30">
      {/* Left: Hamburger + Breadcrumb */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="lg:hidden text-slate-600 hover:text-slate-900 transition-colors p-2 -ml-2"
        >
          <span className="material-symbols-outlined notranslate text-[22px]" translate="no">menu</span>
        </button>
        <h1 className="text-lg font-bold text-slate-900">{breadcrumb[0]}</h1>
      </div>

      {/* Right: Branch selector + Lang + User */}
      <div className="flex items-center gap-3">

        {/* Branch Selector */}
        <div className="relative" ref={businessRef}>
          <button
            onClick={() => setBusinessDropOpen(o => !o)}
            className="flex items-center gap-2 bg-white/50 hover:bg-white border border-transparent hover:border-slate-200 px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 transition-all"
          >
            <span className="material-symbols-outlined notranslate text-accent text-[16px]" translate="no">corporate_fare</span>
            <span className="max-w-[120px] truncate hidden sm:block">
              {selectedBusiness ? selectedBusiness.businesses.name : t.topbar.allBranches}
            </span>
            <span className="material-symbols-outlined notranslate text-slate-400 text-[14px]" translate="no">expand_more</span>
          </button>

          {businessDropOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-100 rounded-xl shadow-xl py-2 z-50 animate-fade-in">
              <button
                onClick={() => { onBusinessSelect(null); setBusinessDropOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-slate-50 transition-colors flex items-center gap-2
                  ${!selectedBusinessId ? 'text-accent' : 'text-slate-600'}`}
              >
                <span className="material-symbols-outlined notranslate text-[16px]" translate="no">hub</span>
                {t.topbar.allBranches}
              </button>
              <div className="border-t border-slate-100 my-1" />
              {linkedBusinesses.map((b) => (
                <button
                  key={b.business_id}
                  onClick={() => { onBusinessSelect(b.business_id); setBusinessDropOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-slate-50 transition-colors flex items-center gap-2
                    ${selectedBusinessId === b.business_id ? 'text-accent' : 'text-slate-600'}`}
                >
                  <span className="material-symbols-outlined notranslate text-[16px]" translate="no">storefront</span>
                  <span className="truncate">{b.businesses.name}</span>
                </button>
              ))}
              <div className="border-t border-slate-100 my-1" />
              <Link
                to="/dashboard/settings"
                onClick={() => setBusinessDropOpen(false)}
                className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined notranslate text-[16px]" translate="no">add</span>
                {t.topbar.addBusiness}
              </Link>
            </div>
          )}
        </div>

        {/* Language Picker */}
        <div className="relative" ref={langRef}>
          <button
            onClick={() => setLangDropOpen(o => !o)}
            className="flex items-center gap-1 bg-white/50 hover:bg-white border border-transparent hover:border-slate-200 px-2.5 py-1.5 rounded-full text-xs font-bold text-slate-600 transition-all"
          >
            <span>{LANG_FLAGS[lang]}</span>
            <span className="hidden sm:block">{lang.toUpperCase()}</span>
          </button>

          {langDropOpen && (
            <div className="absolute right-0 top-full mt-2 w-36 bg-white border border-slate-100 rounded-xl shadow-xl py-2 z-50 animate-fade-in">
              {(['es', 'en', 'fr', 'it', 'pt'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => { setLang(l); setLangDropOpen(false); }}
                  className={`w-full text-left px-4 py-2 text-xs font-bold hover:bg-slate-50 transition-colors flex items-center gap-2
                    ${lang === l ? 'text-accent' : 'text-slate-600'}`}
                >
                  {LANG_FLAGS[l]} {l.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>

        {/* User Avatar */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => setUserDropOpen(o => !o)}
            className="w-8 h-8 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center hover:bg-blue-600 transition-colors border-2 border-transparent hover:border-blue-400"
          >
            {initials}
          </button>

          {userDropOpen && (
            <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-slate-100 rounded-xl shadow-xl py-2 z-50 animate-fade-in">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-900 truncate">{user?.email}</p>
                <p className="text-[10px] text-slate-500 font-bold mt-0.5">Hub Owner</p>
              </div>
              <Link
                to="/dashboard/settings"
                onClick={() => setUserDropOpen(false)}
                className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined notranslate text-[16px]" translate="no">settings</span>
                {t.sidebar.settings}
              </Link>
              <button
                onClick={() => { logout(); }}
                className="w-full text-left px-4 py-2.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined notranslate text-[16px]" translate="no">logout</span>
                {t.settings.logout}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
