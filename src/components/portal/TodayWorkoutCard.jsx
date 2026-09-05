import React from 'react';
import { Link } from 'react-router-dom';
import { Dumbbell, CheckCircle2, ArrowRight, BedDouble } from 'lucide-react';
import { Button } from '@/components/ui';

export default function TodayWorkoutCard({ workout, todayLog, onStartWorkout }) {
  if (!workout) {
    return (
      <div className="surface-card p-5 rounded-xl border border-border/80 flex flex-col justify-between h-full">
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Dumbbell className="w-3.5 h-3.5 text-primary" />
              Today&apos;s Workout
            </span>
          </div>
          <h3 className="text-base font-semibold text-foreground">No Workout Plan</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Your coach has not assigned an active workout plan yet.
          </p>
        </div>
        <div className="mt-4 pt-3 border-t border-border/40">
          <Link to="/portal/exercise" className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
            View workouts <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    );
  }

  const days = workout.days || [];
  // Find current day based on day index or fallback to first active non-rest day or day 1
  const currentDayIndex = 0;
  const currentDay = days[currentDayIndex] || days[0] || null;
  const isRestDay = currentDay?.rest_day;
  const exercises = currentDay?.exercises || currentDay?.workout_exercises || [];
  const isCompleted = !!todayLog;

  return (
    <div className="surface-card p-5 rounded-xl border border-border/80 flex flex-col justify-between h-full glow-subtle transition-all">
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Dumbbell className="w-3.5 h-3.5 text-primary" />
            Today&apos;s Workout
          </span>
          {isCompleted ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3" /> Completed
            </span>
          ) : isRestDay ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
              <BedDouble className="w-3 h-3" /> Rest Day
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
              Ready
            </span>
          )}
        </div>

        {isCompleted ? (
          <div>
            <div className="flex items-center gap-2 mt-1">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-semibold text-foreground">Workout Completed</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Great work! Today&apos;s session is logged. Rest, hydrate, and hit your nutrition goals.
            </p>
            {todayLog.session_name && (
              <p className="text-[11px] text-emerald-400/90 font-mono mt-2 bg-emerald-500/10 px-2 py-1 rounded inline-block">
                Session: {todayLog.session_name}
              </p>
            )}
          </div>
        ) : isRestDay ? (
          <div>
            <h3 className="text-base font-semibold text-foreground">Rest & Recovery Day</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Recovery is where growth happens. Focus on mobility, sleep, and meeting your protein target.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-mono text-primary font-medium">Day {currentDayIndex + 1} of {days.length}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{exercises.length} exercises</span>
            </div>
            <h3 className="text-lg font-semibold text-foreground mt-0.5 font-display">
              {currentDay?.day_name || `Session ${currentDayIndex + 1}`}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 capitalize">
              Split: {workout.split_type?.replace(/_/g, ' ') || 'Custom'}
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 pt-3 border-t border-border/40 flex items-center justify-between">
        {isCompleted ? (
          <Link
            to="/portal/exercise"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium transition-colors"
          >
            Review session history <ArrowRight className="w-3 h-3" />
          </Link>
        ) : isRestDay ? (
          <Link
            to="/portal/exercise"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium transition-colors"
          >
            Preview next workout <ArrowRight className="w-3 h-3" />
          </Link>
        ) : (
          <div className="w-full flex items-center justify-between gap-2">
            <Button
              size="sm"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-sm"
              onClick={onStartWorkout}
            >
              Start Workout
            </Button>
            <Link
              to="/portal/exercise"
              className="text-xs text-muted-foreground hover:text-foreground shrink-0 px-2 py-1 rounded hover:bg-secondary transition-colors"
            >
              Details
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
