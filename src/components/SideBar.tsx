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
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`
        fixed top-0 left-0 bottom-0 z-50 w-[var(--sidebar-w)] bg-white border-r border-slate-200 flex flex-col
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen
      `}>
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-slate-200 shrink-0">
          <Link to="/dashboard" className="flex items-center gap-2">
            <img src="/hub-logo.png" alt="TRIMM Business Hub Logo" className="h-10 w-auto" />
          </Link>
          <button onClick={onClose} className="ml-auto lg:hidden text-slate-400 hover:text-slate-600 transition-colors">
            <span className="material-symbols-outlined notranslate text-[20px]" translate="no">close</span>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-4 space-y-6">
          {/* Main Section */}
          <div>
            <p className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Inicio</p>
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
            <p className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Análisis</p>
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
            <p className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Marketing</p>
            <div className="space-y-1">
              <button
                onClick={() => setMarketingOpen(o => !o)}
                className={`
                  w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all group
                  ${location.pathname.startsWith('/dashboard/marketing')
                    ? 'bg-slate-100 text-accent shadow-sm'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}
                `}
              >
                <span className="material-symbols-outlined notranslate text-[22px] group-hover:scale-110 transition-transform" translate="no">
                  campaign
                </span>
                <span className="flex-1 text-left">{marketingLabels.marketing}</span>
                <span className="material-symbols-outlined notranslate text-[16px] transition-transform" style={{ transform: marketingOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} translate="no">
                  expand_more
                </span>
              </button>

              {marketingOpen && (
                <div className="ml-4 space-y-0.5 border-l border-slate-200 pl-3">
                  {MARKETING_ITEMS.map(item => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      className={`
                        flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all
                        ${location.pathname === item.to
                          ? 'text-accent bg-blue-50/50'
                          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}
                      `}
                    >
                      <span className="material-symbols-outlined notranslate text-[15px]" translate="no">
                        {item.icon}
                      </span>
                      {marketingLabels[item.labelKey]}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Configuration Section */}
          <div>
            <p className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Configuración</p>
            <div className="space-y-1">
              <NavItem
                to="/dashboard/settings"
                icon="settings"
                label={t.sidebar.settings}
                active={location.pathname === '/dashboard/settings'}
                onClick={onClose}
              />
            </div>
          </div>
        </nav>

        {/* Footer logout */}
        <div className="p-4 border-t border-slate-200 shrink-0">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all group"
          >
            <span className="material-symbols-outlined notranslate text-[22px] group-hover:scale-110 transition-transform" translate="no">
              logout
            </span>
            {t.settings.logout}
          </button>
        </div>
      </aside>
    </>
  );
}

const NavItem = ({ to, icon, label, active, onClick }: { to: string; icon: string; label: string; active: boolean; onClick?: () => void }) => (
  <Link
    to={to}
    onClick={onClick}
    className={`
      sidebar-pill flex items-center px-4 gap-3 text-sm font-bold transition-all relative group
      ${active ? 'sidebar-item-active' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}
    `}
  >
    <span className={`material-symbols-outlined notranslate text-[22px] ${active ? 'fill-current' : 'text-slate-400 group-hover:text-slate-600'}`} translate="no">
      {icon}
    </span>
    <span className="truncate">{label}</span>
    {active && <div className="absolute right-2 w-1.5 h-1.5 rounded-full bg-accent"></div>}
  </Link>
);
