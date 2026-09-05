import React, { useMemo } from 'react';
import { Flame, Dumbbell, Apple, ClipboardCheck } from 'lucide-react';
import { getLocalDateKey } from '@/lib/ybs-utils';

const toDayKey = (value) => {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(s)) return s.slice(0, 10);
  return getLocalDateKey(s);
};

export default function ClientConsistencyCard({
  workoutLogs = [],
  nutritionLogs = [],
  forms = [],
  workoutPlan = null,
}) {
  const consistency = useMemo(() => {
    const today = new Date();
    // Calculate start of current week (Monday)
    const dayOfWeek = today.getDay(); // 0 is Sunday
    const distanceToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - distanceToMonday);
    monday.setHours(0, 0, 0, 0);

    const mondayStr = getLocalDateKey(monday);

    // Workouts completed this week
    const thisWeekWorkouts = workoutLogs.filter((l) => {
      const pDate = toDayKey(l.performed_at || l.created_at);
      return pDate >= mondayStr && l.status === 'completed';
    }).length;

    const plannedDays = workoutPlan?.days?.filter((d) => !d.rest_day);
    const plannedWorkoutsPerWeek = plannedDays?.length ?? null;

    // Nutrition days on track this week
    const thisWeekNutrition = nutritionLogs.filter((l) => {
      const lDate = toDayKey(l.log_date || l.created_at);
      return lDate >= mondayStr && l.meals_completed;
    }).length;

    // Check-ins adherence
    const totalForms = forms.length;
    const completedForms = forms.filter((f) => f.submission_status === 'submitted' || f.submission_status === 'reviewed').length;

    // Compute streak (consecutive days ending today or yesterday where user logged workout or meals)
    const activeDatesSet = new Set();
    workoutLogs.forEach((l) => {
      if (l.status === 'completed') {
        const d = toDayKey(l.performed_at || l.created_at);
        if (d) activeDatesSet.add(d);
      }
    });
    nutritionLogs.forEach((l) => {
      if (l.meals_completed) {
        const d = toDayKey(l.log_date || l.created_at);
        if (d) activeDatesSet.add(d);
      }
    });

    let streak = 0;
    const checkDate = new Date();
    const todayStr = getLocalDateKey(checkDate);

    // If today is active, start count from today; if not, test yesterday
    if (activeDatesSet.has(todayStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      checkDate.setDate(checkDate.getDate() - 1);
      const yesterdayStr = getLocalDateKey(checkDate);
      if (!activeDatesSet.has(yesterdayStr)) {
        streak = 0;
      }
    }

    if (streak > 0 || activeDatesSet.has(getLocalDateKey(checkDate))) {
      while (true) {
        const dStr = getLocalDateKey(checkDate);
        if (activeDatesSet.has(dStr)) {
          if (dStr !== todayStr) streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }

    return {
      workouts: thisWeekWorkouts,
      plannedWorkouts: plannedWorkoutsPerWeek,
      nutritionDays: thisWeekNutrition,
      totalForms,
      completedForms,
      streak,
    };
  }, [workoutLogs, nutritionLogs, forms, workoutPlan]);

  return (
    <div className="surface-card p-5 lg:p-6 rounded-xl border border-border/80 glow-subtle">
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
            Your Consistency
          </span>
          <h3 className="text-base font-semibold text-foreground mt-0.5 font-display">Weekly Adherence</h3>
        </div>
        {consistency.streak > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400">
            <Flame className="w-4 h-4 text-amber-400 fill-amber-400" />
            <span className="text-xs font-bold font-display tracking-tight">
              {consistency.streak} Day Adherence Streak
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
        {/* Workouts */}
        <div className="p-3.5 rounded-lg bg-secondary/30 border border-border/40 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
            <Dumbbell className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Workouts</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-bold text-foreground font-mono">{consistency.workouts}</span>
              <span className="text-xs text-muted-foreground font-mono">/ {consistency.plannedWorkouts != null ? `${consistency.plannedWorkouts} this week` : '—'}</span>
            </div>
          </div>
        </div>

        {/* Nutrition */}
        <div className="p-3.5 rounded-lg bg-secondary/30 border border-border/40 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 text-emerald-400">
            <Apple className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Nutrition</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-bold text-foreground font-mono">{consistency.nutritionDays}</span>
              <span className="text-xs text-muted-foreground font-mono"> on track this week</span>
            </div>
          </div>
        </div>

        {/* Check-ins */}
        <div className="p-3.5 rounded-lg bg-secondary/30 border border-border/40 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 text-indigo-400">
            <ClipboardCheck className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Check-ins</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-bold text-foreground font-mono">{consistency.completedForms}</span>
              <span className="text-xs text-muted-foreground font-mono">/ {consistency.totalForms || '—'} completed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
