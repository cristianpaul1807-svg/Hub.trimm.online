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
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col justify-between selection:bg-accent selection:text-white relative overflow-hidden">
      {/* Dynamic Grid Dot Pattern Background */}
      <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] opacity-50 pointer-events-none"></div>

      {/* Top Header */}
      <header className="max-w-7xl w-full mx-auto px-6 py-6 flex items-center justify-between z-10">
        <Link to="/" className="flex items-center gap-2">
          <img src="/hub-logo.png" alt="TRIMM Business Hub Logo" className="h-10 w-auto object-contain" />
        </Link>

        {/* Language Selector */}
        <div className="relative group">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as any)}
            className="appearance-none bg-white/50 hover:bg-white border border-slate-200 rounded-full px-4 py-2 text-xs font-bold text-slate-600 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="es">🇪🇸 ES</option>
            <option value="en">🇺🇸 EN</option>
            <option value="fr">🇫🇷 FR</option>
            <option value="it">🇮🇹 IT</option>
            <option value="pt">🇵🇹 PT</option>
          </select>
        </div>
      </header>

      {/* Login Card */}
      <main className="flex-1 flex items-center justify-center px-6 py-12 z-10">
        <div className="bg-white border border-slate-100 rounded-3xl p-10 max-w-md w-full shadow-soft space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-black tracking-tight text-slate-900">{t.login.title}</h2>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">trimm business suite</p>
          </div>

          {errorMsg && (
            <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl text-xs font-bold leading-relaxed animate-fade-in">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2 px-1">{t.login.emailLabel}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejemplo@correo.com"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm text-slate-900 focus:outline-none focus:border-accent/40 focus:bg-white placeholder-slate-300 transition-all"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2 px-1">
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400">{t.login.passwordLabel}</label>
                <a href="#" className="text-[10px] text-accent hover:underline font-bold">{t.login.forgotPassword}</a>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm text-slate-900 focus:outline-none focus:border-accent/40 focus:bg-white placeholder-slate-300 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-blue-600 text-white py-4 rounded-2xl text-xs font-black tracking-widest uppercase transition-all shadow-lg shadow-accent/20 hover:scale-[1.01] active:scale-95 disabled:opacity-50 disabled:pointer-events-none mt-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>
              ) : (
                t.login.submitButton
              )}
            </button>
          </form>

          <div className="relative flex items-center justify-center py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-100"></div>
            </div>
            <span className="relative bg-white px-4 text-[10px] uppercase font-black tracking-widest text-slate-300">{t.login.noAccess}</span>
          </div>

          {/* Google OAuth Login Button */}
          <button
            type="button"
            onClick={loginWithGoogle}
            className="w-full bg-white hover:bg-slate-50 text-slate-700 py-4 rounded-2xl text-xs font-bold transition-all border border-slate-200 flex items-center justify-center gap-3 active:scale-95 shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.64l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Google OAuth
          </button>

          <a 
            href="https://wa.me/393290914158"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-[10px] text-slate-400 hover:text-accent leading-relaxed font-medium transition-colors"
          >
            {t.login.noAccess}
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-slate-100 text-center text-xs text-slate-400 z-10">
        <p className="font-medium">{t.footer.copyright}</p>
      </footer>
    </div>
  );
}
