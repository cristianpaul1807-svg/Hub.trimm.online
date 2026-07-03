import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useHubLang } from '../contexts/HubLanguageContext';

interface SideBarProps {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { to: '/dashboard', icon: 'dashboard', labelKey: 'metrics' },
  { to: '/dashboard/kpis', icon: 'trending_up', labelKey: 'kpis' },
  { to: '/dashboard/workers', icon: 'people', labelKey: 'workers' },
  { to: '/dashboard/comparator', icon: 'compare_arrows', labelKey: 'comparator' },
];

interface NavItemProps {
  to: string;
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ to, icon, label, active, onClick }: NavItemProps) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`
        flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200
        ${active
          ? 'bg-accent text-white shadow-md'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
        }
      `}
    >
      <span className="material-symbols-outlined notranslate text-[20px]" translate="no">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

export default function SideBar({ isOpen, onClose }: SideBarProps) {
  const location = useLocation();
  const { t } = useHubLang();
  const [marketingOpen, setMarketingOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  const labels: Record<string, string> = {
    metrics: t.sidebar.metrics || 'Metrics',
    kpis: t.sidebar.kpis || 'KPIs',
    workers: t.sidebar.workers || 'Employees',
    comparator: t.sidebar.comparator || 'Comparator',
  };

  return (
    <>
      {/* Sidebar */}
      <aside
        className={`
          fixed lg:relative w-64 h-screen bg-white border-r border-slate-200 flex flex-col z-40 transition-transform duration-300
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="h-16 border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-2">
            <img src="/hub-logo.png" alt="TRIMM Hub" className="h-8 w-auto" />
            <span className="text-sm font-black text-slate-900">Hub</span>
          </div>
          <button onClick={onClose} className="ml-auto lg:hidden text-slate-400 hover:text-slate-600 transition-colors">
            <span className="material-symbols-outlined notranslate text-[20px]" translate="no">close</span>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
          {/* Main Section */}
          <div>
            <p className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t.sidebar.metrics}</p>
            <div className="space-y-1">
              {NAV_ITEMS.slice(0, 1).map((item) => (
                <NavItem
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  label={labels[item.labelKey]}
                  active={isActive(item.to)}
                  onClick={onClose}
                />
              ))}
            </div>
          </div>

          {/* Analytics Section */}
          <div>
            <p className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Analytics</p>
            <div className="space-y-1">
              {NAV_ITEMS.slice(1, 4).map((item) => (
                <NavItem
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  label={labels[item.labelKey]}
                  active={isActive(item.to)}
                  onClick={onClose}
                />
              ))}
            </div>
          </div>

          {/* Marketing Section */}
          <div>
            <p className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t.sidebar.marketing}</p>
            <div className="space-y-1">
              <button
                onClick={() => setMarketingOpen(o => !o)}
                className={`
                  w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all group
                  ${location.pathname.startsWith('/dashboard/marketing')
                    ? 'bg-accent text-white shadow-md'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}
                `}
              >
                <span className="material-symbols-outlined notranslate text-[20px] group-hover:scale-110 transition-transform" translate="no">
                  campaign
                </span>
                <span>{t.sidebar.campaigns}</span>
                <span className="material-symbols-outlined notranslate text-[16px] ml-auto transition-transform" translate="no">
                  {marketingOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {marketingOpen && (
                <div className="pl-4 space-y-1 mt-1">
                  <Link
                    to="/dashboard/marketing/campaigns"
                    onClick={onClose}
                    className="block px-4 py-2 text-xs font-semibold text-slate-600 hover:text-accent transition-colors"
                  >
                    {t.sidebar.campaigns}
                  </Link>
                  <Link
                    to="/dashboard/marketing/billing"
                    onClick={onClose}
                    className="block px-4 py-2 text-xs font-semibold text-slate-600 hover:text-accent transition-colors"
                  >
                    {t.sidebar.billing}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-200 p-4 space-y-2">
          {/* Settings */}
          <div>
            <p className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.sidebar.settings}</p>
            <NavItem
              to="/dashboard/settings"
              icon="settings"
              label={t.sidebar.settings}
              active={isActive('/dashboard/settings')}
              onClick={onClose}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
