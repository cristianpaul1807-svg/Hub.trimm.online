import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHubAuth } from '../../contexts/HubAuthContext';
import { supabase } from '../../lib/supabase';
import CreditBalance from '../../components/marketing/CreditBalance';
import CampaignStatusBadge from '../../components/marketing/CampaignStatusBadge';
import {
  CreditSummary, EMPTY_SUMMARY, fetchCreditSummary, formatCredits, formatMoney,
} from '../../lib/credits';

const TEMPLATE_ICONS: Record<string, string> = {
  reengagement: 'person_heart',
  discount: 'local_offer',
  loyalty: 'loyalty',
};

const TEMPLATE_TITLES: Record<string, string> = {
  reengagement: 'Recuperar clientes',
  discount: 'Campaña de descuento',
  loyalty: 'Fidelización',
};

export default function Marketing() {
  const { user } = useHubAuth();
  const [summary, setSummary] = useState<CreditSummary>(EMPTY_SUMMARY);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [attributed, setAttributed] = useState<{ bookings: number; revenue: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;

    const [{ data: camps }, sum] = await Promise.all([
      supabase.from('hub_campaigns')
        .select('*, hub_campaign_stats(*)')
        .eq('hub_owner_id', user.id)
        .order('created_at', { ascending: false })
        .limit(6),
      fetchCreditSummary().catch(() => EMPTY_SUMMARY),
    ]);

    setCampaigns(camps ?? []);
    setSummary(sum);

    // Retorno agregado de las campañas completadas. Se calcula sumando el
    // rendimiento individual porque la atribución vive en appointments.
    const completed = (camps ?? []).filter((c: any) => c.status === 'completed');
    if (completed.length > 0) {
      const results = await Promise.all(
        completed.map((c: any) =>
          supabase
            .rpc('hub_campaign_performance', { p_campaign_id: c.id })
            .then(({ data, error }) => (error ? null : data)),
        ),
      );

      const totals = results.reduce<{ bookings: number; revenue: number }>(
        (acc, r) => r
          ? {
              bookings: acc.bookings + Number(r.bookings ?? 0),
              revenue: acc.revenue + Number(r.revenue ?? 0),
            }
          : acc,
        { bookings: 0, revenue: 0 },
      );
      setAttributed(totals);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const emailsSent = campaigns.reduce(
    (s, c) => s + (c.hub_campaign_stats?.[0]?.emails_sent ?? 0), 0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-black text-hubText">Email Marketing</h1>
          <p className="text-xs text-hubText3 font-bold mt-0.5">
            Campañas a la base de clientes de tus sucursales
          </p>
        </div>
        <Link
          to="/dashboard/marketing/campaigns"
          className="bg-hubBlue hover:bg-hubBlueHover text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 w-full sm:w-auto justify-center"
        >
          <span className="material-symbols-outlined notranslate text-[16px]" translate="no">add</span>
          Nueva campaña
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <CreditBalance summary={summary} loading={loading} />

        {/* Retorno acumulado — el argumento de venta del producto */}
        <div className="lg:col-span-2 bg-hubSurface border border-hubBorder rounded-3xl p-6 flex flex-col justify-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-hubText3">
            Retorno acumulado
          </p>

          {loading ? (
            <div className="h-16 bg-hubSurface2 rounded-xl animate-pulse mt-4" />
          ) : attributed && attributed.bookings > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-5 mt-4">
                <div>
                  <p className="text-3xl font-black text-hubText tabular-nums tracking-tight">
                    {formatCredits(attributed.bookings)}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-hubText3 mt-0.5">
                    Reservas
                  </p>
                </div>
                <div>
                  <p className="text-3xl font-black text-hubSuccess tabular-nums tracking-tight">
                    {formatMoney(attributed.revenue)}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-hubText3 mt-0.5">
                    Facturado
                  </p>
                </div>
                <div>
                  <p className="text-3xl font-black text-hubText tabular-nums tracking-tight">
                    {formatCredits(emailsSent)}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-hubText3 mt-0.5">
                    Correos
                  </p>
                </div>
              </div>
              <p className="text-xs text-hubText2 leading-relaxed mt-5 pt-4 border-t border-hubBorder">
                Estas reservas llegaron desde los enlaces de tus campañas. Se
                cuentan aquí porque el calendario de Trimm y las campañas son el
                mismo sistema.
              </p>
            </>
          ) : (
            <p className="text-sm text-hubText2 leading-relaxed mt-3 max-w-lg">
              Cuando tus campañas empiecen a generar reservas, verás aquí cuántas
              y cuánto han facturado. No es una estimación: son las citas reales
              que entraron desde los enlaces de tus correos.
            </p>
          )}
        </div>
      </div>

      {/* Accesos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { to: '/dashboard/marketing/campaigns', icon: 'campaign',    label: 'Campañas',  desc: 'Crear y ver resultados' },
          { to: '/dashboard/marketing/credits',   icon: 'add_card',    label: 'Saldo',     desc: 'Recargar packs de envíos' },
          { to: '/dashboard/marketing/billing',   icon: 'credit_card', label: 'Pago',      desc: 'Tarjeta y recibos' },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="bg-hubSurface border border-hubBorder hover:border-hubBlue/40 rounded-2xl p-4 flex flex-col gap-3 transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-hubSurface2 group-hover:bg-hubBlue/10 flex items-center justify-center text-hubBlue transition-colors">
              <span className="material-symbols-outlined notranslate text-[20px]" translate="no">{item.icon}</span>
            </div>
            <div>
              <p className="text-sm font-black text-hubText">{item.label}</p>
              <p className="text-[10px] text-hubText3 font-bold">{item.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Últimas campañas */}
      {campaigns.length > 0 && (
        <div className="bg-hubSurface border border-hubBorder rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-hubBorder/60 flex items-center justify-between gap-2">
            <p className="text-sm font-black text-hubText">Últimas campañas</p>
            <Link
              to="/dashboard/marketing/campaigns"
              className="text-xs text-hubBlue font-bold hover:underline whitespace-nowrap"
            >
              Ver todas
            </Link>
          </div>

          <div className="divide-y divide-hubBorder/60">
            {campaigns.slice(0, 4).map((c) => (
              <Link
                key={c.id}
                to={`/dashboard/marketing/campaigns/${c.id}`}
                className="px-5 py-3.5 flex items-center gap-4 hover:bg-hubSurface2 transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-hubSurface2 flex items-center justify-center text-hubBlue shrink-0">
                  <span className="material-symbols-outlined notranslate text-[16px]" translate="no">
                    {TEMPLATE_ICONS[c.template_type] ?? 'mail'}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-bold text-hubText truncate">
                      {c.template_type === 'discount'
                        ? `Descuento ${c.discount_value}%`
                        : TEMPLATE_TITLES[c.template_type] ?? c.template_type}
                    </p>
                    <CampaignStatusBadge status={c.status} />
                  </div>
                  <p className="text-[10px] text-hubText3 font-bold mt-0.5 tabular-nums">
                    {new Date(c.created_at).toLocaleDateString('es-ES')}
                    {' · '}{formatCredits(c.recipients_count ?? 0)} destinatarios
                  </p>
                </div>

                <span className="material-symbols-outlined notranslate text-hubText3 text-[18px] shrink-0" translate="no">
                  chevron_right
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
