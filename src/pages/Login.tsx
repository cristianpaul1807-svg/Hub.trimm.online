import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useHubAuth } from '../contexts/HubAuthContext';
import { useHubLang } from '../contexts/HubLanguageContext';

export default function Login() {
  const navigate = useNavigate();
  const { login, loginWithGoogle } = useHubAuth();
  const { t, lang, setLang } = useHubLang();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    try {
      setLoading(true);
      setErrorMsg('');
      const res = await login(email, password);

      if (res.success) {
        navigate('/dashboard');
      } else {
        if (res.error === 'no_businesses') {
          setErrorMsg(t.login.errorNoBusinesses);
        } else {
          setErrorMsg(t.login.errorInvalidCredentials);
        }
      }
    } catch (err) {
      setErrorMsg(t.errors.generic);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-hubBg text-hubText font-sans flex flex-col justify-between selection:bg-hubBlue selection:text-white relative overflow-hidden">
      {/* Dynamic Grid Dot Pattern Background (CSS pure) */}
      <div className="absolute inset-0 bg-[radial-gradient(#2a2a2a_1px,transparent_1px)] [background-size:24px_24px] opacity-35 pointer-events-none"></div>

      {/* Top Header */}
      <header className="max-w-7xl w-full mx-auto px-6 py-6 flex items-center justify-between z-10">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-xl font-black tracking-tight text-white">trimm</span>
          <span className="text-xl font-light text-hubBlueText">hub</span>
        </Link>

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
      </header>

      {/* Login Card */}
      <main className="flex-1 flex items-center justify-center px-6 py-12 z-10">
        <div className="bg-hubSurface border border-hubBorder/60 rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6">
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-black tracking-tight text-white">{t.login.title}</h2>
            <p className="text-xs font-bold uppercase tracking-wider text-hubText3">trimm business suite</p>
          </div>

          {errorMsg && (
            <div className="bg-hubDanger/10 border border-hubDanger/20 text-hubDanger p-4 rounded-2xl text-xs font-medium leading-relaxed">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-hubText3 mb-1.5">{t.login.emailLabel}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejemplo@correo.com"
                className="w-full bg-hubSurface2 border border-hubBorder rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-hubBlue/60 placeholder-hubText3 transition-colors"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-[11px] font-black uppercase tracking-wider text-hubText3">{t.login.passwordLabel}</label>
                <a href="#" className="text-[10px] text-hubBlueText hover:underline font-bold">{t.login.forgotPassword}</a>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-hubSurface2 border border-hubBorder rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-hubBlue/60 placeholder-hubText3 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-hubBlue hover:bg-hubBlueHover text-white py-3.5 rounded-2xl text-xs font-black tracking-widest uppercase transition-all shadow-lg shadow-hubBlue/20 hover:scale-[1.01] active:scale-95 disabled:opacity-50 disabled:pointer-events-none mt-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>
              ) : (
                t.login.submitButton
              )}
            </button>
          </form>

          <div className="relative my-6 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-hubBorder"></div>
            </div>
            <span className="relative bg-hubSurface px-3 text-[10px] uppercase font-black tracking-widest text-hubText3">o continuar con</span>
          </div>

          {/* Google OAuth Login Button */}
          <button
            type="button"
            onClick={loginWithGoogle}
            className="w-full bg-hubSurface2 hover:bg-hubBorder text-white py-3 rounded-2xl text-xs font-bold transition-all border border-hubBorder flex items-center justify-center gap-2 active:scale-95"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.64l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Google OAuth
          </button>

          <p className="text-center text-[10px] text-hubText3 leading-relaxed pt-2">
            {t.login.noAccess}
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-hubBorder/20 text-center text-xs text-hubText3 z-10">
        <p>{t.footer.copyright}</p>
      </footer>
    </div>
  );
}
