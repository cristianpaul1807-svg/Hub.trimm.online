import React from 'react';
import { Link } from 'react-router-dom';
import { useHubLang } from '../contexts/HubLanguageContext';

export default function Landing() {
  const { t, lang, setLang } = useHubLang();

  return (
    <div className="min-h-screen bg-hubBg text-hubText selection:bg-hubBlue selection:text-white font-sans">
      {/* Navigation Header */}
      <header className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between border-b border-hubBorder/30">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black tracking-tight text-white">trimm</span>
          <span className="text-xl font-light text-hubBlueText">hub</span>
        </div>

        <div className="flex items-center gap-4">
          {/* Language Selector */}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as any)}
            className="bg-hubSurface border border-hubBorder rounded-full px-3 py-1.5 text-xs font-bold text-hubText2 hover:text-white cursor-pointer transition-colors focus:outline-none"
          >
            <option value="es">🇪🇸 ES</option>
            <option value="en">🇺🇸 EN</option>
            <option value="fr">🇫🇷 FR</option>
            <option value="it">🇮🇹 IT</option>
            <option value="pt">🇵🇹 PT</option>
          </select>

          <Link
            to="/login"
            className="bg-hubBlue hover:bg-hubBlueHover text-white px-5 py-2 rounded-full text-xs font-black tracking-widest uppercase transition-all shadow-lg shadow-hubBlue/20"
          >
            {t.nav.accessButton}
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 lg:py-32 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <h1 className="text-4xl lg:text-6xl font-black tracking-tight leading-none text-white">
            {t.landing.heroTitle}
          </h1>
          <p className="text-lg text-hubText2 max-w-lg leading-relaxed">
            {t.landing.heroSubtitle}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="mailto:soporte@trimm.online?subject=Solicitud de acceso a TRIMM Hub"
              className="bg-hubBlue hover:bg-hubBlueHover text-white px-8 py-4 rounded-full text-sm font-black tracking-wider uppercase transition-all shadow-xl shadow-hubBlue/20 hover:scale-[1.02] active:scale-95"
            >
              {t.landing.ctaPrimary}
            </a>
            <Link
              to="/login"
              className="text-hubText hover:text-hubBlueText px-6 py-4 rounded-full text-sm font-bold transition-colors"
            >
              {t.landing.ctaSecondary}
            </Link>
          </div>
        </div>

        {/* Visual Mockup */}
        <div className="bg-hubSurface border border-hubBorder rounded-3xl p-6 shadow-2xl relative overflow-hidden group hover:border-hubBorder/80 transition-colors">
          <div className="flex items-center justify-between border-b border-hubBorder pb-4 mb-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
            </div>
            <span className="text-[10px] text-hubText3 uppercase tracking-widest font-black">trimm hub preview</span>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-hubSurface2 p-4 rounded-2xl border border-hubBorder/50">
                <p className="text-[9px] text-hubText3 uppercase font-black tracking-wider mb-1">{t.metrics.totalRevenue}</p>
                <p className="text-xl font-black text-white">€24.850</p>
                <p className="text-[9px] text-hubSuccess font-bold mt-1">↑ +12.3%</p>
              </div>
              <div className="bg-hubSurface2 p-4 rounded-2xl border border-hubBorder/50">
                <p className="text-[9px] text-hubText3 uppercase font-black tracking-wider mb-1">{t.metrics.appointments}</p>
                <p className="text-xl font-black text-white">412</p>
                <p className="text-[9px] text-hubSuccess font-bold mt-1">↑ +8.5%</p>
              </div>
              <div className="bg-hubSurface2 p-4 rounded-2xl border border-hubBorder/50">
                <p className="text-[9px] text-hubText3 uppercase font-black tracking-wider mb-1">{t.metrics.avgTicket}</p>
                <p className="text-xl font-black text-white">€60.30</p>
                <p className="text-[9px] text-hubSuccess font-bold mt-1">↑ +3.5%</p>
              </div>
            </div>

            <div className="bg-hubSurface2 p-5 rounded-2xl border border-hubBorder/50">
              <div className="flex justify-between items-center mb-4">
                <p className="text-[10px] text-white uppercase font-black tracking-wider">{t.comparator.title}</p>
                <span className="text-[9px] text-hubText3">Semana en curso</span>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-bold text-hubText2">Sucursal Centro</span>
                    <span className="font-black text-white">€12.450 (50%)</span>
                  </div>
                  <div className="h-2 bg-hubBg rounded-full overflow-hidden">
                    <div className="h-full bg-hubBlue rounded-full" style={{ width: '50%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-bold text-hubText2">Sucursal Norte</span>
                    <span className="font-black text-white">€8.200 (33%)</span>
                  </div>
                  <div className="h-2 bg-hubBg rounded-full overflow-hidden">
                    <div className="h-full bg-hubBlue/70 rounded-full" style={{ width: '33%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-bold text-hubText2">Sucursal Sur</span>
                    <span className="font-black text-white">€4.200 (17%)</span>
                  </div>
                  <div className="h-2 bg-hubBg rounded-full overflow-hidden">
                    <div className="h-full bg-hubBlue/40 rounded-full" style={{ width: '17%' }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* For Who Section */}
      <section className="bg-hubSurface py-20 border-y border-hubBorder/30">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-black text-white tracking-tight mb-12">
            {t.landing.forWhoTitle}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-hubBg border border-hubBorder p-8 rounded-3xl text-left space-y-4 hover:border-hubBlue/40 transition-colors">
              <div className="w-12 h-12 bg-hubBlueMuted rounded-2xl flex items-center justify-center text-hubBlueText">
                <span className="material-symbols-outlined notranslate" translate="no">storefront</span>
              </div>
              <h3 className="text-xl font-black text-white">{t.landing.chains}</h3>
              <p className="text-sm text-hubText2 leading-relaxed">
                {t.landing.chainsDesc}
              </p>
            </div>

            <div className="bg-hubBg border border-hubBorder p-8 rounded-3xl text-left space-y-4 hover:border-hubBlue/40 transition-colors">
              <div className="w-12 h-12 bg-hubBlueMuted rounded-2xl flex items-center justify-center text-hubBlueText">
                <span className="material-symbols-outlined notranslate" translate="no">handshake</span>
              </div>
              <h3 className="text-xl font-black text-white">{t.landing.franchises}</h3>
              <p className="text-sm text-hubText2 leading-relaxed">
                {t.landing.franchisesDesc}
              </p>
            </div>

            <div className="bg-hubBg border border-hubBorder p-8 rounded-3xl text-left space-y-4 hover:border-hubBlue/40 transition-colors">
              <div className="w-12 h-12 bg-hubBlueMuted rounded-2xl flex items-center justify-center text-hubBlueText">
                <span className="material-symbols-outlined notranslate" translate="no">trending_up</span>
              </div>
              <h3 className="text-xl font-black text-white">{t.landing.investors}</h3>
              <p className="text-sm text-hubText2 leading-relaxed">
                {t.landing.investorsDesc}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-black text-white text-center tracking-tight mb-16">
          {t.landing.featuresTitle}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[
            { icon: 'payments', label: t.metrics.totalRevenue, desc: 'Facturación consolidada agregada y desglose por sucursal en tiempo real.' },
            { icon: 'calendar_month', label: t.metrics.appointments, desc: 'Agendamientos completados y reservas gestionadas para todas las sedes.' },
            { icon: 'badge', label: t.sidebar.workers, desc: 'Rendimiento y scontrino medio de tus estilistas y personal en todo el ecosistema.' },
            { icon: 'compare_arrows', label: t.sidebar.comparator, desc: 'Comparador de sucursales en gráficos dinámicos temporales.' },
            { icon: 'loyalty', label: t.metrics.loyaltyCards, desc: 'Total de tarjetas de fidelización activas y campañas de retención globales.' },
            { icon: 'trending_down', label: t.metrics.cancellations, desc: 'Control e insights sobre cancelaciones para optimizar la agenda.' }
          ].map((feat, idx) => (
            <div key={idx} className="flex gap-4 p-4 rounded-2xl hover:bg-hubSurface/30 transition-colors">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-hubSurface border border-hubBorder flex items-center justify-center text-hubBlueText">
                <span className="material-symbols-outlined notranslate text-lg" translate="no">{feat.icon}</span>
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-white text-sm">{feat.label}</h4>
                <p className="text-xs text-hubText2 leading-relaxed">{feat.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it Works Section */}
      <section className="bg-hubSurface py-20 border-y border-hubBorder/30">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl font-black text-white text-center tracking-tight mb-16">
            {t.landing.howTitle}
          </h2>

          <div className="relative border-l border-hubBlue/30 pl-8 space-y-12 ml-4">
            <div className="relative">
              <div className="absolute -left-[41px] top-0.5 w-6 h-6 rounded-full bg-hubBlue flex items-center justify-center text-xs font-black text-white">1</div>
              <p className="text-sm text-hubText leading-relaxed">{t.landing.step1}</p>
            </div>
            <div className="relative">
              <div className="absolute -left-[41px] top-0.5 w-6 h-6 rounded-full bg-hubBlue flex items-center justify-center text-xs font-black text-white">2</div>
              <p className="text-sm text-hubText leading-relaxed">{t.landing.step2}</p>
            </div>
            <div className="relative">
              <div className="absolute -left-[41px] top-0.5 w-6 h-6 rounded-full bg-hubBlue flex items-center justify-center text-xs font-black text-white">3</div>
              <p className="text-sm text-hubText leading-relaxed">{t.landing.step3}</p>
            </div>
          </div>
        </div>
      </section>

      {/* PWA Section */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center space-y-6">
        <div className="w-16 h-16 bg-hubBlueMuted rounded-3xl flex items-center justify-center text-hubBlueText mx-auto border border-hubBlue/20">
          <span className="material-symbols-outlined notranslate text-3xl" translate="no">install_mobile</span>
        </div>
        <h2 className="text-3xl font-black text-white tracking-tight">
          {t.landing.pwaTitle}
        </h2>
        <p className="text-sm text-hubText2 max-w-xl mx-auto leading-relaxed">
          {t.landing.pwaDesc}
        </p>
        <div className="bg-hubSurface border border-hubBorder p-4 rounded-2xl max-w-sm mx-auto flex items-center gap-3 text-left">
          <span className="material-symbols-outlined notranslate text-hubBlueText" translate="no">info</span>
          <p className="text-[11px] text-hubText2 font-medium">
            Toca el menú de tu navegador → "Añadir a la pantalla de inicio" para instalar la aplicación.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-hubBg border-t border-hubBorder/30 py-12">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-lg font-black tracking-tight text-white">trimm</span>
              <span className="text-lg font-light text-hubBlueText">hub</span>
            </div>
            <p className="text-xs text-hubText3 max-w-xs">
              {t.footer.description}
            </p>
          </div>

          <div className="flex flex-wrap md:justify-end gap-6 text-xs text-hubText3">
            <a href="#" className="hover:text-hubText2 transition-colors">{t.footer.privacy}</a>
            <a href="#" className="hover:text-hubText2 transition-colors">{t.footer.terms}</a>
            <a href="mailto:soporte@trimm.online" className="hover:text-hubText2 transition-colors">{t.footer.support}</a>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-8 pt-8 border-t border-hubBorder/10 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-hubText3">
          <p>{t.footer.copyright}</p>
          <div className="flex items-center gap-2">
            <span>🌍</span>
            <button onClick={() => setLang('es')} className={`hover:text-white ${lang === 'es' ? 'text-white font-bold' : ''}`}>ES</button> |
            <button onClick={() => setLang('en')} className={`hover:text-white ${lang === 'en' ? 'text-white font-bold' : ''}`}>EN</button> |
            <button onClick={() => setLang('fr')} className={`hover:text-white ${lang === 'fr' ? 'text-white font-bold' : ''}`}>FR</button> |
            <button onClick={() => setLang('it')} className={`hover:text-white ${lang === 'it' ? 'text-white font-bold' : ''}`}>IT</button> |
            <button onClick={() => setLang('pt')} className={`hover:text-white ${lang === 'pt' ? 'text-white font-bold' : ''}`}>PT</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
