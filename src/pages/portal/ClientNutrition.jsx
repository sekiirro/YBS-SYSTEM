import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { NutritionService } from '@/services/nutrition';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import { LoadingState, Badge } from '@/components/ui';
import { Apple, Utensils, MessageSquare } from 'lucide-react';

export default function ClientNutrition() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [activePlan, setActivePlan] = useState(null);

  const loadData = useCallback(async () => {
    if (!user?.self_client_id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const list = await NutritionService.list({ client_id: user.self_client_id });
      setPlans(list || []);
      setActivePlan(list?.[0] || null);
    } catch (err) {
      console.error('Error loading client nutrition:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.self_client_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) return <LoadingState label="Loading your nutrition plan…" />;

  if (!activePlan) {
    return (
      <div className="space-y-6">
        <div className="pb-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Apple className="w-5 h-5 text-primary" />
            <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
              My Nutrition Plan
            </h1>
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Dietary structure, meal allocations, and macronutrient targets.
          </p>
        </div>

        <ClientEmptyState
          icon={Apple}
          title="No Nutrition Plan Assigned Yet"
          description="Your coach hasn't assigned a nutrition plan yet. We'll show your meal breakdown and macro targets here as soon as it's available."
        />
      </div>
    );
  }

  const calories = Math.round(activePlan.daily_calories || 0);
  const protein = activePlan.daily_protein != null ? Number(activePlan.daily_protein) : 0;
  const carbs = activePlan.daily_carbs != null ? Number(activePlan.daily_carbs) : 0;
  const fat = activePlan.daily_fat != null ? Number(activePlan.daily_fat) : 0;

  // Calculate percentage of calories from each macro (P: 4kcal/g, C: 4kcal/g, F: 9kcal/g)
  const proteinKcal = protein * 4;
  const carbsKcal = carbs * 4;
  const fatKcal = fat * 9;
  const totalCalculatedKcal = (proteinKcal + carbsKcal + fatKcal) || calories || 1;
  const proteinPct = Math.round((proteinKcal / totalCalculatedKcal) * 100);
  const carbsPct = Math.round((carbsKcal / totalCalculatedKcal) * 100);
  const fatPct = Math.max(0, 100 - proteinPct - carbsPct);

  const meals = activePlan.meals || [];

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2">
            <Apple className="w-5 h-5 text-primary" />
            <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
              My Nutrition Plan
            </h1>
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Macronutrient targets, meal timing, and portion recommendations designed for your transformation.
          </p>
        </div>

        {plans.length > 1 && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-xs text-muted-foreground font-medium">Plan:</span>
            <select
              value={activePlan.id}
              onChange={(e) => {
                const sel = plans.find((p) => p.id === e.target.value);
                if (sel) setActivePlan(sel);
              }}
              className="h-9 px-3 rounded-lg bg-secondary/60 border border-border text-xs text-foreground focus:outline-none focus:border-primary/50"
            >
              {plans.map((p, idx) => (
                <option key={p.id} value={p.id}>
                  {p.name} {idx === 0 ? '(Current Active)' : '(Previous)'}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Plan Target Hero Card */}
      <div className="surface-card p-6 rounded-2xl border border-border/80 glow-subtle space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Active Protocol
              </span>
              <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
                {meals.length} Meals / Day
              </Badge>
            </div>
            <h2 className="text-2xl font-bold font-display text-foreground mt-1">
              {activePlan.name}
            </h2>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Daily Target</span>
            <span className="text-3xl font-extrabold font-display text-primary tabular-nums">
              {calories.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">kcal/day</span>
            </span>
          </div>
        </div>

        {/* Macro Distribution Visual Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground font-medium">
            <span>Macronutrient Balance</span>
            <span>{proteinPct}% P · {carbsPct}% C · {fatPct}% F</span>
          </div>
          <div className="h-3 w-full rounded-full bg-secondary/70 overflow-hidden flex">
            <div style={{ width: `${proteinPct}%` }} className="bg-blue-500 h-full" title={`Protein: ${proteinPct}%`} />
            <div style={{ width: `${carbsPct}%` }} className="bg-amber-500 h-full" title={`Carbs: ${carbsPct}%`} />
            <div style={{ width: `${fatPct}%` }} className="bg-rose-500 h-full" title={`Fats: ${fatPct}%`} />
          </div>
        </div>

        {/* Macro Target Stat Boxes */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-4 rounded-xl bg-secondary/40 border border-border/50 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1 text-blue-400 text-xs font-semibold uppercase">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Protein
            </div>
            <span className="text-xl sm:text-2xl font-extrabold text-foreground font-mono">
              {protein > 0 ? `${protein}g` : '—'}
            </span>
            <span className="text-[10px] text-muted-foreground block mt-0.5">{proteinKcal} kcal</span>
          </div>

          <div className="p-4 rounded-xl bg-secondary/40 border border-border/50 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1 text-amber-400 text-xs font-semibold uppercase">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Carbs
            </div>
            <span className="text-xl sm:text-2xl font-extrabold text-foreground font-mono">
              {carbs > 0 ? `${carbs}g` : '—'}
            </span>
            <span className="text-[10px] text-muted-foreground block mt-0.5">{carbsKcal} kcal</span>
          </div>

          <div className="p-4 rounded-xl bg-secondary/40 border border-border/50 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1 text-rose-400 text-xs font-semibold uppercase">
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Fats
            </div>
            <span className="text-xl sm:text-2xl font-extrabold text-foreground font-mono">
              {fat > 0 ? `${fat}g` : '—'}
            </span>
            <span className="text-[10px] text-muted-foreground block mt-0.5">{fatKcal} kcal</span>
          </div>
        </div>

        {/* Coach Notes */}
        {activePlan.notes && (
          <div className="p-4 rounded-xl bg-secondary/30 border border-border/50 text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 text-primary font-semibold">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Coach Guidelines & Instructions</span>
            </div>
            <p className="text-muted-foreground leading-relaxed pl-5">
              {activePlan.notes}
            </p>
          </div>
        )}
      </div>

      {/* Meals & Items Breakdown */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground font-display flex items-center gap-2">
            <Utensils className="w-4 h-4 text-primary" /> Daily Meal Breakdown
          </h2>
          <span className="text-xs text-muted-foreground font-mono">{meals.length} Scheduled Meals</span>
        </div>

        {meals.length === 0 ? (
          <div className="surface-card p-8 text-center rounded-xl border border-border text-muted-foreground text-xs">
            No specific meal items configured for this plan. Follow the macro targets above.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {meals.map((meal, idx) => {
              const items = meal.items || meal.nutrition_items || [];
              const mealKcal = meal.calories != null ? Math.round(meal.calories) : items.reduce((s, it) => s + (Number(it.calories) || 0), 0);

              return (
                <div
                  key={meal.id || idx}
                  className="surface-card p-5 rounded-2xl border border-border/80 hover:border-primary/30 transition-all space-y-3"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-border/50">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                        {idx + 1}
                      </div>
                      <h3 className="text-sm font-semibold text-foreground font-display">
                        {meal.meal_name || `Meal ${idx + 1}`}
                      </h3>
                    </div>

                    {mealKcal > 0 && (
                      <span className="text-xs font-mono font-bold text-primary px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
                        {mealKcal} kcal
                      </span>
                    )}
                  </div>

                  {meal.notes && (
                    <p className="text-[11px] text-muted-foreground italic bg-secondary/30 px-3 py-1.5 rounded-lg border border-border/30">
                      {meal.notes}
                    </p>
                  )}

                  {/* Food items list */}
                  <div className="space-y-1.5 pt-1">
                    {items.map((it, itIdx) => (
                      <div
                        key={it.id || itIdx}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/20 hover:bg-secondary/40 transition-colors text-xs"
                      >
                        <span className="font-medium text-foreground">{it.food_name || 'Food Item'}</span>
                        <div className="flex items-center gap-4 font-mono text-muted-foreground">
                          <span>{it.amount} {it.unit}</span>
                          {it.calories != null && (
                            <span className="font-bold text-foreground min-w-[50px] text-right">
                              {Math.round(it.calories)} kcal
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
