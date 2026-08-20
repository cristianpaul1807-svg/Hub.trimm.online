import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import CampaignStatusBadge from '../../components/marketing/CampaignStatusBadge';
import {
  CampaignPerformance, fetchPerformance, formatCredits, formatMoney,
} from '../../lib/credits';

const TEMPLATE_TITLES: Record<string, string> = {
  reengagement: 'Recuperar clientes',
  discount: 'Campaña de descuento',
  loyalty: 'Fidelización',
};

/** Embudo de entrega: cada peldaño se mide sobre los correos entregados. */
function FunnelRow({
  label, value, of, tone = 'neutral',
}: {
  label: string; value: number; of: number; tone?: 'neutral' | 'good' | 'bad';
}) {
  const pct = of > 0 ? (value / of) * 100 : 0;
  const barColor =
    tone === 'good' ? 'bg-hubSuccess' : tone === 'bad' ? 'bg-hubDanger' : 'bg-hubBlue';

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-bold text-hubText2">{label}</span>
        <span className="text-xs font-black text-hubText tabular-nums">
          {formatCredits(value)}
          <span className="text-hubText3 font-bold ml-1.5">{pct.toFixed(1)}%</span>
        </span>
      </div>
      <div className="h-1.5 bg-hubSurface2 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<any>(null);
  const [perf, setPerf] = useState<CampaignPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [{ data: camp, error: campErr }, p] = await Promise.all([
        supabase.from('hub_campaigns').select('*').eq('id', id).maybeSingle(),
        fetchPerformance(id).catch(() => null),
      ]);
      if (campErr) throw campErr;
      if (!camp) throw new Error('Campaña no encontrada.');
      setCampaign(camp);
      setPerf(p);
      setError('');
    } catch (err: any) {
      setError(err.message ?? 'No se pudo cargar la campaña.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Mientras la campaña está en curso, refrescar sin recargar la página.
  useEffect(() => {
    if (!campaign || !['queued', 'sending'].includes(campaign.status)) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [campaign, load]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-6 w-52 bg-hubSurface2 rounded" />
        <div className="h-32 bg-hubSurface2 rounded-3xl" />
        <div className="h-64 bg-hubSurface2 rounded-2xl" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="space-y-4">
        <Link to="/dashboard/marketing/campaigns" className="text-xs font-black text-hubBlue hover:underline">
          ← Volver a campañas
        </Link>
        <div className="bg-hubDanger/10 border border-hubDanger/25 text-hubDanger rounded-2xl px-4 py-3 text-xs font-bold">
          {error}
        </div>
      </div>
    );
  }

  const inProgress = ['queued', 'sending'].includes(campaign.status);
  const delivered = perf?.delivered ?? 0;
  const hasBookings = (perf?.bookings ?? 0) > 0;
  const roi = perf?.roi ?? null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link to="/dashboard/marketing/campaigns" className="text-xs font-black text-hubBlue hover:underline inline-flex items-center gap-1">
          <span className="material-symbols-outlined notranslate text-[14px]" translate="no">arrow_back</span>
          Volver a campañas
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-black text-hubText">
            {campaign.template_type === 'discount'
              ? `Descuento ${campaign.discount_value}%`
              : TEMPLATE_TITLES[campaign.template_type] ?? campaign.template_type}
          </h1>
          <CampaignStatusBadge status={campaign.status} />
        </div>

        <p className="text-xs text-hubText3 font-bold tabular-nums">
          Creada el {new Date(campaign.created_at).toLocaleDateString('es-ES', {
            day: 'numeric', month: 'long', year: 'numeric',
          })}
          {campaign.completed_at && ` · Finalizada el ${new Date(campaign.completed_at).toLocaleDateString('es-ES')}`}
        </p>
      </div>

      {campaign.failure_reason && (
        <div className="bg-hubDanger/10 border border-hubDanger/25 text-hubDanger rounded-2xl px-4 py-3 text-xs font-bold">
          {campaign.failure_reason}
        </div>
      )}

      {/* ── Retorno: lo que ningún competidor puede mostrar ──────── */}
      <div className={`rounded-3xl p-6 border ${hasBookings
        ? 'bg-hubBlue/5 border-hubBlue/30'
        : 'bg-hubSurface border-hubBorder'}`}>
        <p className="text-[10px] font-black uppercase tracking-widest text-hubText3">
          Retorno de la campaña
        </p>

        {hasBookings ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mt-4">
              <div>
                <p className="text-3xl font-black text-hubText tabular-nums tracking-tight">
                  {formatCredits(perf!.bookings)}
                </p>
                <p className="text-[10px] font-black uppercase tracking-wider text-hubText3 mt-0.5">
                  Reservas
                </p>
              </div>
              <div>
                <p className="text-3xl font-black text-hubSuccess tabular-nums tracking-tight">
                  {formatMoney(perf!.revenue)}
                </p>
                <p className="text-[10px] font-black uppercase tracking-wider text-hubText3 mt-0.5">
                  Facturado
                </p>
              </div>
              <div>
                <p className="text-3xl font-black text-hubText tabular-nums tracking-tight">
                  {formatMoney(perf!.spend)}
                </p>
                <p className="text-[10px] font-black uppercase tracking-wider text-hubText3 mt-0.5">
                  Invertido
                </p>
              </div>
              <div>
                <p className="text-3xl font-black text-hubBlue tabular-nums tracking-tight">
                  {roi !== null ? `${roi}×` : '—'}
                </p>
                <p className="text-[10px] font-black uppercase tracking-wider text-hubText3 mt-0.5">
                  Retorno
                </p>
              </div>
            </div>

            {roi !== null && roi >= 1 && (
              <p className="text-xs text-hubText2 leading-relaxed mt-5 pt-4 border-t border-hubBlue/20">
                Por cada euro invertido en esta campaña has facturado{' '}
                <strong className="text-hubText">{roi.toFixed(2).replace('.', ',')} €</strong>.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-hubText2 leading-relaxed mt-3 max-w-xl">
            {inProgress
              ? 'La campaña se está enviando. Las reservas atribuidas irán apareciendo aquí conforme tus clientes reserven desde el correo.'
              : 'Todavía no hay reservas atribuidas a esta campaña. Aparecen aquí en cuanto alguien reserva desde el enlace del correo.'}
          </p>
        )}
      </div>

      {/* ── Progreso de envío ───────────────────────────────────── */}
      {inProgress && (
        <div className="bg-hubSurface border border-hubBorder rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-hubBlue animate-pulse" />
              <p className="text-sm font-black text-hubText">Enviando</p>
            </div>
            <span className="text-xs font-black text-hubText2 tabular-nums">
              {formatCredits(perf?.sent ?? 0)} / {formatCredits(campaign.recipients_count ?? 0)}
            </span>
          </div>
          <div className="h-2 bg-hubSurface2 rounded-full overflow-hidden">
            <div
              className="h-full bg-hubBlue rounded-full transition-all duration-500"
              style={{
                width: `${campaign.recipients_count > 0
                  ? Math.min(100, ((perf?.sent ?? 0) / campaign.recipients_count) * 100)
                  : 0}%`,
              }}
            />
          </div>
          <p className="text-[11px] text-hubText3 leading-relaxed">
            El envío se hace por tramos para no saturar los filtros de correo.
            Puedes cerrar esta pantalla: continúa por su cuenta.
          </p>
        </div>
      )}

      {/* ── Embudo ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-hubSurface border border-hubBorder rounded-2xl p-5 space-y-4">
          <p className="text-sm font-black text-hubText">Entrega</p>

          <div className="flex items-baseline gap-2 pb-2">
            <span className="text-2xl font-black text-hubText tabular-nums">
              {formatCredits(perf?.sent ?? 0)}
            </span>
            <span className="text-xs font-bold text-hubText3">correos enviados</span>
          </div>

          <div className="space-y-4">
            <FunnelRow label="Entregados"  value={delivered}             of={perf?.sent ?? 0} tone="good" />
            <FunnelRow label="Abiertos"    value={perf?.opened ?? 0}     of={delivered} />
            <FunnelRow label="Con clic"    value={perf?.clicked ?? 0}    of={delivered} />
            <FunnelRow label="Rebotados"   value={perf?.bounced ?? 0}    of={perf?.sent ?? 0} tone="bad" />
          </div>

          {(perf?.sent ?? 0) > 0 && delivered === 0 && (
            <p className="text-[11px] text-hubText3 leading-relaxed border-t border-hubBorder/60 pt-3">
              Las entregas y aperturas aparecen cuando Resend confirma cada
              correo. Si nunca llegan a llenarse, revisa que el webhook esté
              configurado.
            </p>
          )}
        </div>

        <div className="bg-hubSurface border border-hubBorder rounded-2xl p-5 space-y-4">
          <p className="text-sm font-black text-hubText">Salud de la lista</p>

          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Tasa de apertura', value: `${perf?.open_rate ?? 0}%`, tone: 'text-hubText' },
              { label: 'Tasa de clic',     value: `${perf?.click_rate ?? 0}%`, tone: 'text-hubText' },
              { label: 'Bajas',            value: formatCredits(perf?.unsubscribed ?? 0), tone: 'text-hubText' },
              { label: 'Quejas de spam',   value: formatCredits(perf?.complained ?? 0),
                tone: (perf?.complained ?? 0) > 0 ? 'text-hubDanger' : 'text-hubText' },
            ].map((m) => (
              <div key={m.label} className="bg-hubSurface2 rounded-xl p-3.5">
                <p className={`text-xl font-black tabular-nums ${m.tone}`}>{m.value}</p>
                <p className="text-[10px] font-black uppercase tracking-wider text-hubText3 mt-0.5">
                  {m.label}
                </p>
              </div>
            ))}
          </div>

          {delivered > 0 && (perf?.complained ?? 0) / delivered > 0.003 && (
            <p className="text-[11px] text-hubDanger font-bold leading-relaxed border-t border-hubBorder/60 pt-3">
              La tasa de quejas supera el 0,3%. Por encima de ese umbral los
              proveedores de correo empiezan a penalizar tus envíos: revisa a
              quién estás escribiendo antes de la próxima campaña.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
