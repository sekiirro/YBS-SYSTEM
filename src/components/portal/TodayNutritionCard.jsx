import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Apple, CheckCircle2, ArrowRight, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui';

export default function TodayNutritionCard({ nutrition, todayLog, onLogMeals }) {
  const [logging, setLogging] = useState(false);
  const [justLogged, setJustLogged] = useState(false);
  const [error, setError] = useState(null);

  const isLogged = !!todayLog || justLogged;

  const handleLog = async () => {
    if (isLogged || logging) return;
    setError(null);
    try {
      setLogging(true);
      await onLogMeals();
      setJustLogged(true);
    } catch (err) {
      console.error('Failed to log meals:', err);
      setError(
        typeof err?.message === 'string'
          ? err.message
          : 'We could not save your meal log right now. Please try again.'
      );
    } finally {
      setLogging(false);
    }
  };

  if (!nutrition) {
    return (
      <div className="surface-card p-5 rounded-xl border border-border/80 flex flex-col justify-between h-full">
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Apple className="w-3.5 h-3.5 text-primary" />
              Today&apos;s Nutrition
            </span>
          </div>
          <h3 className="text-base font-semibold text-foreground">Nutrition Plan Preparing</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Your coach has not assigned your nutrition plan yet. We will display your targets as soon as it is published.
          </p>
        </div>
        <div className="mt-4 pt-3 border-t border-border/40">
          <Link to="/portal/nutrition" className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
            View nutrition <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    );
  }

  const calories = Math.round(nutrition.daily_calories || 0);
  const protein = nutrition.daily_protein != null ? `${nutrition.daily_protein}g` : '—';
  const carbs = nutrition.daily_carbs != null ? `${nutrition.daily_carbs}g` : '—';
  const fat = nutrition.daily_fat != null ? `${nutrition.daily_fat}g` : '—';

  return (
    <div className="surface-card p-5 rounded-xl border border-border/80 flex flex-col justify-between h-full glow-subtle transition-all">
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Apple className="w-3.5 h-3.5 text-primary" />
            Today&apos;s Nutrition
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-secondary/80 text-foreground border border-border/80">
            {calories > 0 ? `${calories} kcal / day` : 'Active'}
          </span>
        </div>

        {/* Macro targets mini grid */}
        <div className="grid grid-cols-3 gap-2 py-2 mb-3 bg-secondary/30 rounded-lg p-2 border border-border/40 text-center">
          <div>
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Protein</span>
            <span className="text-xs font-bold text-foreground font-mono">{protein}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Carbs</span>
            <span className="text-xs font-bold text-foreground font-mono">{carbs}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Fat</span>
            <span className="text-xs font-bold text-foreground font-mono">{fat}</span>
          </div>
        </div>

        {/* "Did you eat your meals today?" Interaction */}
        {isLogged ? (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 space-y-1 animate-in fade-in duration-300">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Meals logged for today</span>
            </div>
            <p className="text-[11px] text-emerald-300/80 leading-tight">
              Great job! You&apos;re staying on track with your nutritional discipline.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                Did you eat your meals today?
              </span>
            </div>
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 space-y-1 animate-in fade-in duration-300">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>Meals could not be logged</span>
                </div>
                <p className="text-[11px] text-red-300/80 leading-tight break-words">{error}</p>
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={logging}
              onClick={handleLog}
              className="w-full border-primary/30 hover:border-primary/60 hover:bg-primary/10 text-primary text-xs font-semibold h-9"
            >
              {logging ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Saving...
                </>
              ) : (
                'Yes, I did ✓'
              )}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between">
        <Link
          to="/portal/nutrition"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium transition-colors"
        >
          View full meal breakdown <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
