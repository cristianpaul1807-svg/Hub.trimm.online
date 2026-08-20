import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type State =
  | { kind: 'loading' }
  | { kind: 'done'; email: string; businessName: string }
  | { kind: 'error'; message: string };

/**
 * Página pública de baja. Se abre desde el pie de los correos de campaña, sin
 * sesión: la RPC hub_unsubscribe_by_token está expresamente concedida al rol
 * anónimo porque este es el único camino que tiene una persona para dejar de
 * recibir correos.
 */
export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? params.get('token');
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({
        kind: 'error',
        message: 'Al enlace le falta el identificador. Ábrelo de nuevo desde el correo original.',
      });
      return;
    }

    let cancelled = false;

    supabase.rpc('hub_unsubscribe_by_token', { p_token: token })
      .then(({ data, error }) => {
        if (cancelled) return;

        if (error || !data?.success) {
          setState({
            kind: 'error',
            message: data?.error === 'Enlace no válido'
              ? 'Este enlace ya no es válido. Puede que ya te hubieras dado de baja anteriormente.'
              : 'No hemos podido procesar tu solicitud. Inténtalo de nuevo en unos minutos.',
          });
          return;
        }

        setState({ kind: 'done', email: data.email, businessName: data.business_name });
      });

    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-hubBg">
      <div className="bg-hubSurface border border-hubBorder rounded-3xl p-10 w-full max-w-md text-center shadow-[0_10px_40px_-14px_rgba(15,23,42,0.14)]">
        <img src="/hub-logo.png" alt="TRIMM" className="h-8 w-auto mx-auto mb-6" />

        {state.kind === 'loading' && (
          <>
            <div className="w-10 h-10 border-2 border-hubBlue border-t-transparent rounded-full animate-spin mx-auto mb-5" />
            <p className="text-sm text-hubText2 font-bold">Procesando tu baja…</p>
          </>
        )}

        {state.kind === 'done' && (
          <>
            <div className="w-14 h-14 rounded-full bg-hubSuccess/10 text-hubSuccess flex items-center justify-center mx-auto mb-5">
              <span className="material-symbols-outlined notranslate text-[28px]" translate="no">check</span>
            </div>
            <h1 className="text-lg font-black text-hubText mb-3">Baja confirmada</h1>
            <p className="text-sm text-hubText2 leading-relaxed">
              <strong className="text-hubText">{state.email}</strong> ya no recibirá
              campañas comerciales de {state.businessName}.
            </p>
            <p className="text-xs text-hubText3 mt-5 pt-5 border-t border-hubBorder leading-relaxed">
              Los recordatorios y confirmaciones de tus citas seguirán llegando
              con normalidad: son avisos del servicio, no publicidad.
            </p>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <div className="w-14 h-14 rounded-full bg-hubDanger/10 text-hubDanger flex items-center justify-center mx-auto mb-5">
              <span className="material-symbols-outlined notranslate text-[28px]" translate="no">error</span>
            </div>
            <h1 className="text-lg font-black text-hubText mb-3">No hemos podido completar la baja</h1>
            <p className="text-sm text-hubText2 leading-relaxed">{state.message}</p>
          </>
        )}
      </div>
    </div>
  );
}
