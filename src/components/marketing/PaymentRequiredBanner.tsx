import React from 'react';
import { Link } from 'react-router-dom';

interface PaymentRequiredBannerProps {
  activeCampaigns?: number;
}

export default function PaymentRequiredBanner({ activeCampaigns = 0 }: PaymentRequiredBannerProps) {
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 shrink-0">
        <span className="material-symbols-outlined notranslate text-[20px]" translate="no">credit_card_off</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black text-amber-300">Sin método de pago activo</p>
        <p className="text-xs text-amber-400/80 mt-0.5 leading-relaxed">
          {activeCampaigns > 0
            ? `Tienes ${activeCampaigns} campaña${activeCampaigns > 1 ? 's' : ''} pausada${activeCampaigns > 1 ? 's' : ''}. Conecta tu tarjeta para reactivarlas.`
            : 'Conecta un método de pago para crear y lanzar campañas de email marketing.'}
        </p>
      </div>
      <Link
        to="/dashboard/marketing/billing"
        className="bg-amber-500 hover:bg-amber-400 text-black text-xs font-black px-3 py-2 rounded-xl transition-all shrink-0"
      >
        Conectar →
      </Link>
    </div>
  );
}
