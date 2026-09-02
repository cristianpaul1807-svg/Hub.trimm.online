import { useEffect, useRef, useState } from 'react';
import {
  fetchCampaignQuota, previewCampaign, sendCampaignTest, type TestQuota,
} from '../../lib/templates';

interface Props {
  campaignType: string;
  discountValue?: number;
  businessName?: string;
}

/**
 * El correo tal cual va a salir, dentro del asistente.
 *
 * Va aquí y no en la pantalla de Plantillas porque este es el momento en
 * que hace falta: justo antes de pagar por mandar algo a toda tu base de
 * clientes. Ver el asunto y el cuerpo reales evita el error caro —un
 * descuento mal puesto, un nombre que no encaja— cuando todavía se puede
 * corregir gratis.
 *
 * El HTML lo genera el servidor con el mismo renderizador que usa el envío.
 * Reconstruirlo aquí sería tener dos versiones del correo y descubrir la
 * diferencia por una queja.
 */
export default function CampaignPreview({
  campaignType, discountValue, businessName,
}: Props) {
  const [html, setHtml] = useState('');
  const [subject, setSubject] = useState('');
  const [cargando, setCargando] = useState(true);
  const [quota, setQuota] = useState<TestQuota | null>(null);
  const [avisoAbierto, setAvisoAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState('');
  const [error, setError] = useState('');

  // El porcentaje se mueve con un deslizador: se espera a que la mano se
  // pare antes de pedir el correo otra vez.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setCargando(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await previewCampaign(campaignType, { discountValue, businessName });
        setSubject(r.subject);
        setHtml(r.html);
        setError('');
      } catch (e: any) {
        setError(e.message);
      } finally {
        setCargando(false);
      }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [campaignType, discountValue, businessName]);

  useEffect(() => {
    fetchCampaignQuota(campaignType).then(setQuota);
  }, [campaignType]);

  const enviar = async () => {
    setEnviando(true);
    setError('');
    try {
      const r = await sendCampaignTest(campaignType, { discountValue, businessName });
      setQuota(r.quota);
      setOk(r.sent_to);
      setAvisoAbierto(false);
    } catch (e: any) {
      setError(e.message);
      setAvisoAbierto(false);
      fetchCampaignQuota(campaignType).then(setQuota);
    } finally {
      setEnviando(false);
    }
  };

  const sinCupo = quota?.remaining === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-hubText3">
            Así se verá el correo
          </p>
          <p className="text-sm font-black text-hubText truncate">{subject || '…'}</p>
        </div>

        <div className="text-right shrink-0">
          <button
            type="button"
            onClick={() => setAvisoAbierto(true)}
            disabled={cargando || sinCupo}
            className="bg-hubSurface2 border border-hubBorder hover:border-hubBlue/40 text-hubText px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined notranslate text-[15px]" translate="no">outgoing_mail</span>
            Enviarme una prueba
          </button>
          {quota && (
            <p className="text-[10px] font-bold text-hubText3 mt-1">
              {quota.remaining > 0
                ? `Te quedan ${quota.remaining} de 2 hoy`
                : 'Sin pruebas hoy'}
            </p>
          )}
        </div>
      </div>

      {ok && (
        <div className="bg-hubSuccess/10 border border-hubSuccess/25 text-hubSuccess rounded-xl px-4 py-3 text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined notranslate text-[18px]" translate="no">mark_email_read</span>
          Prueba enviada a {ok}. Revisa tu bandeja antes de pagar.
        </div>
      )}

      {error && (
        <div className="bg-hubDanger/10 border border-hubDanger/25 text-hubDanger rounded-xl px-4 py-3 text-xs font-bold">
          {error}
        </div>
      )}

      {/* En un iframe con sandbox: el correo trae sus propios estilos y no
          debe poder tocar la página del Hub. */}
      {cargando ? (
        <div className="w-full h-[420px] bg-hubSurface2 border border-hubBorder rounded-2xl animate-pulse" />
      ) : (
        <iframe
          title="Vista previa del correo"
          srcDoc={html}
          sandbox=""
          className="w-full h-[420px] bg-white border border-hubBorder rounded-2xl"
        />
      )}

      {/* ── Aviso antes de gastar una prueba ─────────────────────── */}
      {avisoAbierto && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setAvisoAbierto(false)}
        >
          <div
            className="bg-hubSurface border border-hubBorder rounded-3xl p-6 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-11 h-11 rounded-2xl bg-hubBlue/10 text-hubBlue flex items-center justify-center">
              <span className="material-symbols-outlined notranslate text-[22px]" translate="no">outgoing_mail</span>
            </div>

            <div>
              <h3 className="text-base font-black text-hubText">Enviarte una prueba</h3>
              <p className="text-xs text-hubText2 mt-2 leading-relaxed">
                El correo se envía al buzón con el que entras al Hub, no a tus
                clientes. Tienes <strong className="text-hubText">2 pruebas al día</strong> por
                tipo de campaña
                {quota && quota.remaining < 2 && ` (te queda${quota.remaining === 1 ? '' : 'n'} ${quota.remaining})`}.
              </p>
              <p className="text-xs text-hubText2 mt-2 leading-relaxed">
                Ábrelo en tu móvil o en Gmail para ver cómo llega de verdad.
                Si te convence, sigue al paso 3 y lánzala.
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setAvisoAbierto(false)}
                disabled={enviando}
                className="flex-1 bg-hubSurface2 border border-hubBorder text-hubText2 hover:text-hubText py-3 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={enviar}
                disabled={enviando}
                className="flex-1 bg-hubBlue hover:bg-hubBlueHover text-white py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center"
              >
                {enviando
                  ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
