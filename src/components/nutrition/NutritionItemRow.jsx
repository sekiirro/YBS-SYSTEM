import React from 'react';
import { Trash2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NutritionItemRow({ item, onUpdateAmount, onRemove }) {
  const numAmount = Number(item.amount);
  const isInvalid = !numAmount || numAmount <= 0 || isNaN(numAmount);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-secondary/20 hover:bg-secondary/35 border border-border/40 transition-colors">
      {/* Food Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground truncate">{item.food_name}</span>
          {item.brand && (
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-secondary/50 border border-border/30">
              {item.brand}
            </span>
          )}
        </div>

        {isInvalid && (
          <div className="flex items-center gap-1 text-[11px] text-amber-400 mt-1">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Enter an amount greater than 0</span>
          </div>
        )}
      </div>

      {/* Editable Amount with Unit */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative w-24">
            <input
              type="number"
              min="0.1"
              step="any"
              value={item.amount}
              onChange={(e) => onUpdateAmount(e.target.value)}
              className={cn(
                'w-full h-8 px-2 pr-7 rounded-md bg-background border text-xs font-mono text-right focus:outline-none focus:border-primary/50',
                isInvalid ? 'border-amber-400/60 text-amber-400' : 'border-border'
              )}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono select-none">
              {item.unit || 'g'}
            </span>
          </div>
        </div>

        {/* Macros Breakdown */}
        <div className="grid grid-cols-4 gap-2 text-center text-xs w-44 font-mono">
          <div>
            <span className="text-[10px] text-muted-foreground block text-center uppercase font-sans">Cal</span>
            <span className="font-semibold text-primary">{Math.round(item.calories || 0)}</span>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground block text-center uppercase font-sans">P</span>
            <span>{Math.round((item.protein || 0) * 10) / 10}g</span>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground block text-center uppercase font-sans">C</span>
            <span>{Math.round((item.carbs || 0) * 10) / 10}g</span>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground block text-center uppercase font-sans">F</span>
            <span>{Math.round((item.fat || 0) * 10) / 10}g</span>
          </div>
        </div>

        {/* Remove Action */}
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Remove food"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
