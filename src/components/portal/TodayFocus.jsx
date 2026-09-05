import React from 'react';
import TodayWorkoutCard from './TodayWorkoutCard';
import TodayNutritionCard from './TodayNutritionCard';
import TodayFormsCard from './TodayFormsCard';

export default function TodayFocus({
  workout,
  nutrition,
  forms,
  todayWorkoutLog,
  todayNutritionLog,
  onStartWorkout,
  onLogMeals,
  onOpenForm,
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3.5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display">
            Today&apos;s Focus
          </h2>
          <p className="text-xs text-muted-foreground">
            The core daily commitments required to achieve your goal.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <TodayWorkoutCard
          workout={workout}
          todayLog={todayWorkoutLog}
          onStartWorkout={onStartWorkout}
        />
        <TodayNutritionCard
          nutrition={nutrition}
          todayLog={todayNutritionLog}
          onLogMeals={onLogMeals}
        />
        <TodayFormsCard
          forms={forms}
          onOpenForm={onOpenForm}
        />
      </div>
    </div>
  );
}
