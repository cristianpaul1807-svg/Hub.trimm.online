
type CampaignStatus =
  | 'draft' | 'paid' | 'queued' | 'sending' | 'completed'
  | 'paused_no_billing' | 'cancelled' | 'failed';

const STATUS_CONFIG: Record<CampaignStatus, { label: string; color: string; icon: string }> = {
  draft:             { label: 'Borrador',    color: 'text-hubText2 bg-hubSurface2 border-hubBorder',              icon: 'draft' },
  paid:              { label: 'Lista',       color: 'text-hubBlue bg-hubBlue/10 border-hubBlue/25',               icon: 'check_circle' },
  queued:            { label: 'En cola',     color: 'text-hubBlue bg-hubBlue/10 border-hubBlue/25',               icon: 'schedule_send' },
  sending:           { label: 'Enviando',    color: 'text-hubWarning bg-hubWarning/10 border-hubWarning/25',      icon: 'send' },
  completed:         { label: 'Completada',  color: 'text-hubSuccess bg-hubSuccess/10 border-hubSuccess/25',      icon: 'task_alt' },
  paused_no_billing: { label: 'Pausada',     color: 'text-hubWarning bg-hubWarning/10 border-hubWarning/30',      icon: 'pause_circle' },
  cancelled:         { label: 'Cancelada',   color: 'text-hubText2 bg-hubSurface2 border-hubBorder',              icon: 'cancel' },
  failed:            { label: 'Con errores', color: 'text-hubDanger bg-hubDanger/10 border-hubDanger/25',         icon: 'error' },
};

export default function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-black whitespace-nowrap ${cfg.color}`}>
      <span className="material-symbols-outlined notranslate text-[12px]" translate="no">{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}
