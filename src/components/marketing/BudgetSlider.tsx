import React from 'react';

interface BudgetSliderProps {
  budget: number;
  onBudgetChange: (v: number) => void;
  availableClients: number;
  loading?: boolean;
}

const PRICE_PER_EMAIL = 0.01;
const MIN_BUDGET = 5;
const MAX_BUDGET = 500;

export default function BudgetSlider({ budget, onBudgetChange, availableClients, loading }: BudgetSliderProps) {
  const estimatedReach = Math.min(Math.floor(budget / PRICE_PER_EMAIL), availableClients);
  const reachPercent = availableClients > 0 ? (estimatedReach / availableClients) * 100 : 0;

  return (
    <div className="bg-hubSurface border border-hubBorder rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-black text-white">Presupuesto y Alcance</p>
        <div className="text-xs font-bold text-hubText3 bg-hubSurface2 border border-hubBorder px-2.5 py-1 rounded-full">
          €{PRICE_PER_EMAIL.toFixed(2)} / email
        </div>
      </div>

      {/* Budget Input */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-hubText2 text-sm font-bold">€</span>
          <input
            type="number"
            min={MIN_BUDGET}
            max={MAX_BUDGET}
            step={5}
            value={budget}
            onChange={e => onBudgetChange(Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, Number(e.target.value))))}
            className="flex-1 bg-hubSurface2 border border-hubBorder rounded-xl px-3 py-2 text-xl font-black text-white focus:outline-none focus:border-hubBlue/60 text-center"
          />
        </div>
        <input
          type="range"
          min={MIN_BUDGET}
          max={MAX_BUDGET}
          step={5}
          value={budget}
          onChange={e => onBudgetChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-full bg-hubSurface2 appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-hubBlue [&::-webkit-slider-thumb]:cursor-pointer"
          style={{ accentColor: '#2563eb' }}
        />
        <div className="flex justify-between text-[10px] font-bold text-hubText3">
          <span>€{MIN_BUDGET}</span>
          <span>€{MAX_BUDGET}</span>
        </div>
      </div>

      {/* Reach Estimate */}
      <div className="bg-hubBlueMuted border border-hubBlue/20 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-hubText2">Alcance estimado</p>
          <span className="text-xs font-black text-hubBlueText">
            {loading ? '...' : `${estimatedReach.toLocaleString()} / ${availableClients.toLocaleString()}`}
          </span>
        </div>

        <div className="h-2 bg-hubSurface2 rounded-full overflow-hidden">
          <div
            className="h-full bg-hubBlue rounded-full transition-all duration-300"
            style={{ width: `${reachPercent}%` }}
          />
        </div>

        <p className="text-[11px] text-hubText2 leading-relaxed">
          {loading ? (
            <span className="animate-pulse">Calculando clientes disponibles...</span>
          ) : estimatedReach >= availableClients ? (
            <>Llegarás al <strong className="text-white">100% de tus clientes</strong> disponibles.</>
          ) : (
            <>Llegarás a <strong className="text-white">{estimatedReach.toLocaleString()} clientes</strong> de {availableClients.toLocaleString()} disponibles.</>
          )}
        </p>
      </div>

      {/* Cost Breakdown */}
      <div className="border-t border-hubBorder/40 pt-4 space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-hubText3 font-bold">Emails a enviar</span>
          <span className="text-white font-black">{estimatedReach.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-hubText3 font-bold">Precio por email</span>
          <span className="text-white font-black">€{PRICE_PER_EMAIL.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm border-t border-hubBorder/40 pt-2 mt-2">
          <span className="text-white font-black">Total a pagar</span>
          <span className="text-hubBlueText font-black text-base">€{budget.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
