import React from 'react';
import { Flame, Beef, Wheat, Droplets } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * NutritionMacroSummary — Executive macro overview widget for Column 2.
 *
 * Displays:
 *  - Total Calories (prominent, tabular numbers)
 *  - Protein (Sky-400), Carbs (Amber-400), Fat (Rose-400)
 *  - Proportional macro calorie distribution bar
 *
 * Strictly uses existing values; no modified formulas.
 */
export default function NutritionMacroSummary({ totals, className }) {
  const calories = Math.max(0, Number(totals?.calories) || 0);
  const protein = Math.max(0, Number(totals?.protein) || 0);
  const carbs = Math.max(0, Number(totals?.carbs) || 0);
  const fat = Math.max(0, Number(totals?.fat) || 0);

  // Calorie contributions from macros (4 kcal/g protein, 4 kcal/g carbs, 9 kcal/g fat)
  const proteinCals = protein * 4;
  const carbsCals = carbs * 4;
  const fatCals = fat * 9;
  const macroCalSum = proteinCals + carbsCals + fatCals;

  const pPct = macroCalSum > 0 ? Math.round((proteinCals / macroCalSum) * 100) : 0;
  const cPct = macroCalSum > 0 ? Math.round((carbsCals / macroCalSum) * 100) : 0;
  const fPct = macroCalSum > 0 ? Math.max(0, 100 - pPct - cPct) : 0;

  return (
    <div className={cn('surface-card rounded-xl border border-border/70 p-3.5 space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        {/* Total Calories */}
        <div className="flex items-baseline gap-2">
          <div className="flex items-center gap-1.5 text-primary">
            <Flame className="w-4 h-4 shrink-0 fill-primary/20" />
            <span className="text-[12px] font-semibold uppercase tracking-wider font-mono">Total</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-display tracking-tight text-foreground tabular-nums">
              {calories.toLocaleString()}
            </span>
            <span className="text-[12px] text-muted-foreground font-mono">kcal</span>
          </div>
        </div>

        {/* Macro Pill Badges */}
        <div className="flex items-center gap-2 font-mono text-[12px]">
          {/* Protein */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-sky-500/10 border border-sky-500/20 text-sky-400">
            <Beef className="w-3 h-3 shrink-0" />
            <span className="font-semibold">{Math.round(protein)}g</span>
            <span className="text-[12px] text-sky-400/70">P ({pPct}%)</span>
          </div>

          {/* Carbs */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <Wheat className="w-3 h-3 shrink-0" />
            <span className="font-semibold">{Math.round(carbs)}g</span>
            <span className="text-[12px] text-amber-400/70">C ({cPct}%)</span>
          </div>

          {/* Fat */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <Droplets className="w-3 h-3 shrink-0" />
            <span className="font-semibold">{Math.round(fat)}g</span>
            <span className="text-[12px] text-rose-400/70">F ({fPct}%)</span>
          </div>
        </div>
      </div>

      {/* Proportional Macro Distribution Bar */}
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden flex">
          {macroCalSum > 0 ? (
            <>
              <div
                style={{ width: `${pPct}%` }}
                className="h-full bg-sky-400 transition-all duration-300"
                title={`Protein: ${protein}g (${pPct}%)`}
              />
              <div
                style={{ width: `${cPct}%` }}
                className="h-full bg-amber-400 transition-all duration-300"
                title={`Carbs: ${carbs}g (${cPct}%)`}
              />
              <div
                style={{ width: `${fPct}%` }}
                className="h-full bg-rose-400 transition-all duration-300"
                title={`Fat: ${fat}g (${fPct}%)`}
              />
            </>
          ) : (
            <div className="h-full w-full bg-muted/30" />
          )}
        </div>
      </div>
    </div>
  );
}
