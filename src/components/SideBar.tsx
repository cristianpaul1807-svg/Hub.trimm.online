import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';

interface SideBarProps {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { to: '/dashboard', icon: 'monitoring', labelKey: 'metrics' },
  { to: '/dashboard/kpis', icon: 'insights', labelKey: 'kpis' },
  { to: '/dashboard/workers', icon: 'people', labelKey: 'workers' },
  { to: '/dashboard/comparator', icon: 'compare_arrows', labelKey: 'comparator' },
];

const MARKETING_ITEMS = [
  { to: '/dashboard/marketing', icon: 'campaign', labelKey: 'marketing' },
  { to: '/dashboard/marketing/campaigns', icon: 'mail', labelKey: 'campaigns' },
  { to: '/dashboard/marketing/billing', icon: 'credit_card', labelKey: 'billing' },
];

export default function SideBar({ isOpen, onClose }: SideBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useHubAuth();
  const { t } = useHubLang();
  const [marketingOpen, setMarketingOpen] = useState(location.pathname.startsWith('/dashboard/marketing'));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const labels: Record<string, string> = {
    metrics: t.sidebar.metrics,
    kpis: t.sidebar.kpis,
    workers: t.sidebar.workers,
    comparator: t.sidebar.comparator,
  };

  const marketingLabels: Record<string, string> = {
    marketing: t.sidebar.marketing || 'Marketing',
    campaigns: t.sidebar.campaigns || 'Campañas',
    billing: t.sidebar.billing || 'Facturación',
  };

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`
        fixed top-0 left-0 bottom-0 z-50 w-[240px] bg-hubSurface border-r border-hubBorder flex flex-col
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen
      `}>
        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-hubBorder/60 shrink-0">
          <Link to="/dashboard" className="flex items-center gap-1.5">
            <img src="/hub-logo.png" alt="TRIMM Business Hub Logo" className="h-8 w-auto" />
          </Link>
          <button onClick={onClose} className="ml-auto lg:hidden text-hubText3 hover:text-white transition-colors">
            <span className="material-symbols-outlined notranslate text-[20px]" translate="no">close</span>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all group
                ${isActive(item.to)
                  ? 'bg-hubBlueMuted text-hubBlueText border-l-2 border-hubBlue'
                  : 'text-hubText2 hover:bg-hubSurface2 hover:text-white'}
              `}
            >
              <span className={`material-symbols-outlined notranslate text-[20px] transition-transform group-hover:scale-110 ${isActive(item.to) ? 'text-hubBlue' : ''}`} translate="no">
                {item.icon}
              </span>
              {labels[item.labelKey]}
            </Link>
          ))}

          {/* Marketing Sub-menu */}
          <div className="my-3 border-t border-hubBorder/40" />

          <button
            onClick={() => setMarketingOpen(o => !o)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all group
              ${location.pathname.startsWith('/dashboard/marketing')
                ? 'bg-hubBlueMuted text-hubBlueText border-l-2 border-hubBlue'
                : 'text-hubText2 hover:bg-hubSurface2 hover:text-white'}`}
          >
            <span className="material-symbols-outlined notranslate text-[20px] group-hover:scale-110 transition-transform" translate="no">campaign</span>
            <span className="flex-1 text-left">{marketingLabels.marketing}</span>
            <span className="material-symbols-outlined notranslate text-[16px] transition-transform" style={{ transform: marketingOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} translate="no">expand_more</span>
          </button>

          {marketingOpen && (
            <div className="ml-4 space-y-0.5 border-l border-hubBorder/40 pl-3">
              {MARKETING_ITEMS.map(item => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={`flex items-center gap-2 px-2 py-2 rounded-lg text-xs font-bold transition-all
                    ${location.pathname === item.to
                      ? 'text-hubBlueText bg-hubBlueMuted'
                      : 'text-hubText3 hover:text-white hover:bg-hubSurface2'}`}
                >
                  <span className="material-symbols-outlined notranslate text-[15px]" translate="no">{item.icon}</span>
                  {marketingLabels[item.labelKey]}
                </Link>
              ))}
            </div>
          )}

          <div className="my-3 border-t border-hubBorder/40" />

          <Link
            to="/dashboard/settings"
            onClick={onClose}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all group
              ${location.pathname === '/dashboard/settings'
                ? 'bg-hubBlueMuted text-hubBlueText border-l-2 border-hubBlue'
                : 'text-hubText2 hover:bg-hubSurface2 hover:text-white'}
            `}
          >
            <span className="material-symbols-outlined notranslate text-[20px] group-hover:scale-110 transition-transform" translate="no">settings</span>
            {t.sidebar.settings}
          </Link>

          <div className="my-3 border-t border-hubBorder/40" />

          <Link
            to="/dashboard/kpis"
            onClick={onClose}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all group
              ${location.pathname === '/dashboard/kpis'
                ? 'bg-hubBlueMuted text-hubBlueText border-l-2 border-hubBlue'
                : 'text-hubText2 hover:bg-hubSurface2 hover:text-white'}
            `}
          >
            <span className="material-symbols-outlined notranslate text-[20px] group-hover:scale-110 transition-transform" translate="no">info</span>
            {t.sidebar.backToHub}
          </Link>
        </nav>

        {/* Footer logout */}
        <div className="p-3 border-t border-hubBorder/40 shrink-0">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-hubText2 hover:bg-red-900/20 hover:text-red-400 transition-all group"
          >
            <span className="material-symbols-outlined notranslate text-[20px] group-hover:scale-110 transition-transform" translate="no">logout</span>
            {t.settings.logout}
          </button>
        </div>
      </aside>
    </>
  );
}
