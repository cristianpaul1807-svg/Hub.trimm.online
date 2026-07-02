import React from 'react';

type CampaignStatus = 'draft' | 'paid' | 'sending' | 'completed' | 'paused_no_billing' | 'cancelled';

const STATUS_CONFIG: Record<CampaignStatus, { label: string; color: string; icon: string }> = {
  draft:            { label: 'Borrador',       color: 'text-hubText3 bg-hubSurface2 border-hubBorder',                   icon: 'draft' },
  paid:             { label: 'Pagada',          color: 'text-hubBlueText bg-hubBlueMuted border-hubBlue/20',               icon: 'check_circle' },
  sending:          { label: 'Enviando...',     color: 'text-amber-300 bg-amber-500/10 border-amber-500/20',               icon: 'send' },
  completed:        { label: 'Completada',      color: 'text-hubSuccess bg-hubSuccess/10 border-hubSuccess/20',            icon: 'task_alt' },
  paused_no_billing:{ label: 'Pausada — Sin pago', color: 'text-amber-300 bg-amber-500/10 border-amber-500/30',           icon: 'pause_circle' },
  cancelled:        { label: 'Cancelada',       color: 'text-hubDanger bg-hubDanger/10 border-hubDanger/20',              icon: 'cancel' },
};

export default function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-black ${cfg.color}`}>
      <span className="material-symbols-outlined notranslate text-[12px]" translate="no">{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}
