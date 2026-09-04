import React from 'react';
import { Flame, Beef, Wheat, Droplets } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

const MACRO_COLORS = {
  protein: '#38bdf8', // Sky 400
  carbs: '#fbbf24',   // Amber 400
  fat: '#f87171',     // Red 400
};

export default function PlanSummaryBar({ totals }) {
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
  const fPct = macroCalSum > 0 ? Math.round((fatCals / macroCalSum) * 100) : 0;

  const chartData = [
    { name: 'Protein', value: Math.round(proteinCals), grams: protein, color: MACRO_COLORS.protein },
    { name: 'Carbs', value: Math.round(carbsCals), grams: carbs, color: MACRO_COLORS.carbs },
    { name: 'Fat', value: Math.round(fatCals), grams: fat, color: MACRO_COLORS.fat },
  ].filter((d) => d.value > 0);

  return (
    <div className="surface-card rounded-2xl border border-border p-4 lg:p-5 glow-accent-radial">
      <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
        {/* Macro Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 w-full">
          {/* Calories */}
          <div className="p-3.5 rounded-xl bg-secondary/30 border border-border/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider">Calories</span>
              <Flame className="w-4 h-4 text-primary" />
            </div>
            <div>
              <span className="text-2xl font-bold font-display tracking-tight text-primary tabular-nums">
                {calories}
              </span>
              <span className="text-[11px] text-muted-foreground ml-1">kcal</span>
            </div>
          </div>

          {/* Protein */}
          <div className="p-3.5 rounded-xl bg-secondary/30 border border-border/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider">Protein</span>
              <Beef className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <span className="text-2xl font-bold font-display tracking-tight text-foreground tabular-nums">
                {protein}
              </span>
              <span className="text-[11px] text-muted-foreground ml-1">g ({pPct}%)</span>
            </div>
          </div>

          {/* Carbs */}
          <div className="p-3.5 rounded-xl bg-secondary/30 border border-border/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider">Carbs</span>
              <Wheat className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <span className="text-2xl font-bold font-display tracking-tight text-foreground tabular-nums">
                {carbs}
              </span>
              <span className="text-[11px] text-muted-foreground ml-1">g ({cPct}%)</span>
            </div>
          </div>

          {/* Fat */}
          <div className="p-3.5 rounded-xl bg-secondary/30 border border-border/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider">Fat</span>
              <Droplets className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <span className="text-2xl font-bold font-display tracking-tight text-foreground tabular-nums">
                {fat}
              </span>
              <span className="text-[11px] text-muted-foreground ml-1">g ({fPct}%)</span>
            </div>
          </div>
        </div>

        {/* Informational Macro Ratio Visualization */}
        <div className="flex items-center gap-4 shrink-0 px-4 py-2 rounded-xl bg-secondary/20 border border-border/40">
          <div className="w-16 h-16 relative shrink-0">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    content={({ payload }) => {
                      if (!payload || !payload[0]) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-popover text-popover-foreground text-[11px] px-2 py-1 rounded shadow-md border border-border">
                          {d.name}: {d.grams}g ({d.value} kcal)
                        </div>
                      );
                    }}
                  />
                  <Pie
                    data={chartData}
                    dataKey="value"
                    innerRadius={18}
                    outerRadius={28}
                    stroke="none"
                    paddingAngle={3}
                  >
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full rounded-full border-2 border-dashed border-border/60 flex items-center justify-center text-[9px] text-muted-foreground">
                0%
              </div>
            )}
          </div>

          <div className="space-y-1 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
              <span className="text-muted-foreground">Protein:</span>
              <span className="font-semibold text-foreground font-mono">{pPct}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <span className="text-muted-foreground">Carbs:</span>
              <span className="font-semibold text-foreground font-mono">{cPct}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
              <span className="text-muted-foreground">Fat:</span>
              <span className="font-semibold text-foreground font-mono">{fPct}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
