import React from 'react';
import { Link } from 'react-router-dom';
import { useHubLang } from '../contexts/HubLanguageContext';

export default function Landing() {
  const { t, lang, setLang } = useHubLang();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-accent selection:text-white font-sans">
      {/* Navigation Header */}
      <header className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between border-b border-slate-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <img src="/hub-logo.png" alt="TRIMM Logo" className="h-10 w-auto object-contain" />
        </div>

        <div className="flex items-center gap-6">
          {/* Language Selector */}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as any)}
            className="bg-slate-100 border-none rounded-full px-4 py-2 text-xs font-bold text-slate-600 cursor-pointer transition-all focus:outline-none hover:bg-slate-200"
          >
            <option value="es">🇪🇸 ES</option>
            <option value="en">🇺🇸 EN</option>
            <option value="fr">🇫🇷 FR</option>
            <option value="it">🇮🇹 IT</option>
            <option value="pt">🇵🇹 PT</option>
          </select>

          <Link
            to="/login"
            className="bg-accent hover:bg-blue-600 text-white px-6 py-2.5 rounded-full text-xs font-black tracking-widest uppercase transition-all shadow-lg shadow-accent/20 active:scale-95"
          >
            {t.nav.accessButton}
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 lg:py-32 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div className="space-y-8">
          <div className="inline-block bg-blue-50 text-accent px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">
            Business Intelligence
          </div>
          <h1 className="text-5xl lg:text-7xl font-black tracking-tight leading-[0.9] text-slate-900">
            {t.landing.heroTitle}
          </h1>
          <p className="text-lg text-slate-500 max-w-lg leading-relaxed font-medium">
            {t.landing.heroSubtitle}
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-4">
            <a
              href="mailto:soporte@trimm.online?subject=Solicitud de acceso a TRIMM Hub"
              className="bg-accent hover:bg-blue-600 text-white px-10 py-5 rounded-full text-sm font-black tracking-wider uppercase transition-all shadow-xl shadow-accent/30 hover:scale-[1.02] active:scale-95"
            >
              {t.landing.ctaPrimary}
            </a>
            <Link
              to="/login"
              className="text-slate-600 hover:text-accent px-8 py-5 rounded-full text-sm font-bold transition-colors border border-slate-200 hover:border-accent/20"
            >
              {t.landing.ctaSecondary}
            </Link>
          </div>
        </div>

        {/* Visual Mockup */}
        <div className="bg-white border border-slate-100 rounded-[32px] p-8 shadow-soft relative overflow-hidden group hover:shadow-xl transition-all duration-500">
          <div className="flex items-center justify-between border-b border-slate-50 pb-6 mb-8">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-400"></div>
              <div className="w-3 h-3 rounded-full bg-amber-400"></div>
              <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
            </div>
            <span className="text-[10px] text-slate-300 uppercase tracking-widest font-black">{t.meta.siteTitle}</span>
          </div>

          <div className="space-y-8">
            <div className="grid grid-cols-3 gap-6">
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100/50">
                <p className="text-[9px] text-slate-400 uppercase font-black tracking-wider mb-2">{t.metrics.totalRevenue}</p>
                <p className="text-2xl font-black text-slate-900">€24.8k</p>
                <p className="text-[9px] text-emerald-600 font-black mt-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">trending_up</span> 12.3%
                </p>
              </div>
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100/50">
                <p className="text-[9px] text-slate-400 uppercase font-black tracking-wider mb-2">{t.metrics.appointments}</p>
                <p className="text-2xl font-black text-slate-900">412</p>
                <p className="text-[9px] text-emerald-600 font-black mt-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">trending_up</span> 8.5%
                </p>
              </div>
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100/50">
                <p className="text-[9px] text-slate-400 uppercase font-black tracking-wider mb-2">{t.metrics.avgTicket}</p>
                <p className="text-2xl font-black text-slate-900">€60</p>
                <p className="text-[9px] text-emerald-600 font-black mt-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">trending_up</span> 3.5%
                </p>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100/50">
              <div className="flex justify-between items-center mb-6">
                <p className="text-[10px] text-slate-900 uppercase font-black tracking-widest">{t.comparator.title}</p>
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Live data</span>
              </div>
              <div className="space-y-4">
                {[
                  { name: 'Sucursal Centro', val: '50%', color: 'bg-accent' },
                  { name: 'Sucursal Norte', val: '33%', color: 'bg-blue-400' },
                  { name: 'Sucursal Sur', val: '17%', color: 'bg-blue-200' }
                ].map((item, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-2">
                      <span className="font-bold text-slate-600">{item.name}</span>
                      <span className="font-black text-slate-900">{item.val}</span>
                    </div>
                    <div className="h-2 bg-slate-200/50 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color} rounded-full transition-all duration-1000`} style={{ width: item.val }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* For Who Section */}
      <section className="bg-white py-24 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-black text-slate-900 tracking-tight mb-16">
            {t.landing.forWhoTitle}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              { icon: 'storefront', title: t.landing.chains, desc: t.landing.chainsDesc },
              { icon: 'handshake', title: t.landing.franchises, desc: t.landing.franchisesDesc },
              { icon: 'trending_up', title: t.landing.investors, desc: t.landing.investorsDesc }
            ].map((item, i) => (
              <div key={i} className="bg-slate-50 border border-slate-100 p-10 rounded-[32px] text-left space-y-5 hover:shadow-lg hover:border-accent/10 transition-all group">
                <div className="w-14 h-14 bg-white shadow-sm rounded-2xl flex items-center justify-center text-accent group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined notranslate text-3xl" translate="no">{item.icon}</span>
                </div>
                <h3 className="text-2xl font-black text-slate-900">{item.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed font-medium">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <h2 className="text-4xl font-black text-slate-900 text-center tracking-tight mb-20">
          {t.landing.featuresTitle}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {[
            { icon: 'payments', label: t.metrics.totalRevenue, desc: 'Facturación consolidada agregada y desglose por sucursal en tiempo real.' },
            { icon: 'calendar_month', label: t.metrics.appointments, desc: 'Agendamientos completados y reservas gestionadas para todas las sedes.' },
            { icon: 'badge', label: t.sidebar.workers, desc: 'Rendimiento y scontrino medio de tus estilistas y personal en todo el ecosistema.' },
            { icon: 'compare_arrows', label: t.sidebar.comparator, desc: 'Comparador de sucursales en gráficos dinámicos temporales.' },
            { icon: 'loyalty', label: t.metrics.loyaltyCards, desc: 'Total de tarjetas de fidelización activas y campañas de retención globales.' },
            { icon: 'trending_down', label: t.metrics.cancellations, desc: 'Control e insights sobre cancelaciones para optimizar la agenda.' }
          ].map((feat, idx) => (
            <div key={idx} className="flex gap-6 p-6 rounded-[24px] hover:bg-white hover:shadow-soft transition-all border border-transparent hover:border-slate-100">
              <div className="shrink-0 w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-accent">
                <span className="material-symbols-outlined notranslate text-2xl" translate="no">{feat.icon}</span>
              </div>
              <div className="space-y-2">
                <h4 className="font-black text-slate-900 text-base">{feat.label}</h4>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">{feat.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PWA Section */}
      <section className="max-w-5xl mx-auto px-6 py-24 text-center space-y-8">
        <div className="w-20 h-20 bg-blue-50 rounded-[28px] flex items-center justify-center text-accent mx-auto border border-blue-100/50 shadow-inner">
          <span className="material-symbols-outlined notranslate text-4xl" translate="no">install_mobile</span>
        </div>
        <h2 className="text-4xl font-black text-slate-900 tracking-tight">
          {t.landing.pwaTitle}
        </h2>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed font-medium">
          {t.landing.pwaDesc}
        </p>
        <div className="bg-white border border-slate-200 p-5 rounded-2xl max-w-md mx-auto flex items-center gap-4 text-left shadow-sm">
          <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
            <span className="material-symbols-outlined notranslate text-xl" translate="no">lightbulb</span>
          </div>
          <p className="text-xs text-slate-600 font-bold leading-tight">
            {t.landing.pwaDesc}
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <img src="/hub-logo.png" alt="TRIMM Hub" className="h-12 w-auto" />
            <p className="text-sm text-slate-400 max-w-xs leading-relaxed font-medium">
              {t.footer.description}
            </p>
          </div>

          <div className="flex flex-wrap md:justify-end gap-10 text-sm font-bold">
            <a href="#" className="text-slate-400 hover:text-white transition-colors">{t.footer.privacy}</a>
            <a href="#" className="text-slate-400 hover:text-white transition-colors">{t.footer.terms}</a>
            <a href="https://wa.me/393290914158" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">{t.footer.support}</a>
          </div>
        </div>
        
        <div className="max-w-7xl mx-auto px-6 mt-16 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6 text-xs text-slate-500 font-bold">
          <p>{t.footer.copyright}</p>
          <div className="flex items-center gap-4 bg-white/5 px-4 py-2 rounded-full">
            <span className="text-[10px] uppercase tracking-widest opacity-50">{t.settings.language}</span>
            <div className="flex gap-3">
              {['es', 'en', 'fr', 'it', 'pt'].map((l) => (
                <button 
                  key={l} 
                  onClick={() => setLang(l as any)} 
                  className={`hover:text-white transition-colors uppercase ${lang === l ? 'text-accent' : ''}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
