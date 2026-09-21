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
          <h2 className="ybs-section-title">
            Today&apos;s Focus
          </h2>
          <p className="text-xs text-muted-foreground">
            A little consistency. Meaningful progress.
          </p>
        </div>
      </div>

      <div className="ybs-focus-grid">
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
