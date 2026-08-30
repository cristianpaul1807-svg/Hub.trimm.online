import { Link } from 'react-router-dom';
import { useHubLang } from '../contexts/HubLanguageContext';

// Canal de contacto para pedir acceso. WhatsApp por delante del correo a
// propósito: un enlace mailto no hace nada visible en un ordenador sin cliente
// de correo configurado, y este sector vive en WhatsApp.
const WHATSAPP_NUMBER = '393290914158';
const wa = (mensaje: string) =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`;

// Dos mensajes distintos: quien pide acceso desde la portada y quien busca
// soporte desde el pie no vienen a lo mismo.
const WHATSAPP_URL = wa('Hola, quiero solicitar acceso a TRIMM Hub para mis negocios.');
const WHATSAPP_SUPPORT_URL = wa('Hola, necesito ayuda con TRIMM Hub.');
const SUPPORT_EMAIL = 'soporte@trimm.online';
const SUPPORT_MAILTO =
  `mailto:${SUPPORT_EMAIL}?subject=` +
  encodeURIComponent('Solicitud de acceso a TRIMM Hub');

// Páginas legales de TRIMM. No pude verificar estas rutas desde fuera porque
// trimm.online devuelve 200 para cualquier URL (es una aplicación de una sola
// página), así que confírmalas y corrígelas aquí si no coinciden.
const PRIVACY_URL = 'https://trimm.online/privacidad';
const TERMS_URL = 'https://trimm.online/terminos';

export default function Landing() {
  const { t, lang, setLang } = useHubLang();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-accent selection:text-white font-sans">
      {/* Navigation Header */}
      <header className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between border-b border-slate-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="TRIMM Hub — inicio">
          <img src="/hub-logo.png" alt="TRIMM Hub" className="h-10 w-auto object-contain" />
        </Link>

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
          <div className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center gap-4">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
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
            <p className="text-xs text-slate-400 font-medium">
              {t.landing.ctaEmailFallback}{' '}
              <a href={SUPPORT_MAILTO} className="text-slate-500 hover:text-accent font-bold underline underline-offset-2">
                {SUPPORT_EMAIL}
              </a>
            </p>
          </div>
        </div>

        {/* Visual Mockup */}
        <div className="bg-white border border-slate-100 rounded-[32px] p-5 sm:p-8 shadow-soft relative overflow-hidden group hover:shadow-xl transition-all duration-500">
          <div className="flex items-center justify-between border-b border-slate-50 pb-5 mb-6 sm:pb-6 sm:mb-8 gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-3 h-3 rounded-full bg-red-400"></div>
              <div className="w-3 h-3 rounded-full bg-amber-400"></div>
              <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
            </div>
            <span className="text-[10px] text-slate-300 uppercase tracking-widest font-black truncate">{t.meta.siteTitle}</span>
          </div>

          <div className="space-y-6 sm:space-y-8">
            {/* Tres tarjetas en una columna estrecha: el tamaño de la cifra y el
                espaciado escalan con el ancho para que ningún número se salga
                de su recuadro en móvil. min-w-0 evita que el grid se desborde. */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {[
                { label: t.metrics.totalRevenue, value: '€24,8k', delta: '12,3%' },
                { label: t.metrics.appointments, value: '412',    delta: '8,5%' },
                { label: t.metrics.avgTicket,    value: '€60',    delta: '3,5%' },
              ].map((kpi) => (
                <div key={kpi.label} className="min-w-0 bg-slate-50 p-3 sm:p-4 rounded-2xl border border-slate-100/50">
                  <p className="text-[9px] text-slate-400 uppercase font-black tracking-wider mb-1.5 leading-tight line-clamp-2">
                    {kpi.label}
                  </p>
                  <p
                    data-kpi-value
                    className="text-sm sm:text-lg md:text-xl lg:text-2xl font-black text-slate-900 tabular-nums leading-none"
                  >
                    {kpi.value}
                  </p>
                  {/* Flecha en SVG y no con la fuente de iconos: si esa fuente
                      tarda o no carga, la ligadura se pinta como la palabra
                      "trending_up" y vuelve a desbordar la tarjeta. */}
                  <p className="text-[9px] text-emerald-600 font-black mt-1.5 flex items-center gap-0.5 tabular-nums">
                    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 shrink-0 fill-current" aria-hidden="true">
                      <path d="M6 2 L10.5 9 L1.5 9 Z" />
                    </svg>
                    {kpi.delta}
                  </p>
                </div>
              ))}
            </div>

            <div className="bg-slate-50 p-4 sm:p-6 rounded-2xl border border-slate-100/50">
              <div className="flex justify-between items-center mb-5 sm:mb-6 gap-3">
                <p className="text-[10px] text-slate-900 uppercase font-black tracking-widest truncate">{t.comparator.title}</p>
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter shrink-0">Live data</span>
              </div>
              <div className="space-y-4">
                {[
                  { name: 'Sucursal Centro', val: '50%', color: 'bg-accent' },
                  { name: 'Sucursal Norte', val: '33%', color: 'bg-blue-400' },
                  { name: 'Sucursal Sur', val: '17%', color: 'bg-blue-200' }
                ].map((item, i) => (
                  <div key={i}>
                    <div className="flex justify-between items-baseline text-xs mb-2 gap-2">
                      <span className="font-bold text-slate-600 truncate">{item.name}</span>
                      <span className="font-black text-slate-900 tabular-nums shrink-0">{item.val}</span>
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
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">{t.footer.privacy}</a>
            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">{t.footer.terms}</a>
            <a href={WHATSAPP_SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">{t.footer.support}</a>
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
