import React, { useState, useEffect, useRef } from 'react';
import { WorkoutsService } from '@/services/workouts';
import { Button, Modal } from '@/components/ui';
import ExerciseVideoModal from '@/components/workouts/ExerciseVideoModal';
import {
  Dumbbell,
  Play,
  CheckCircle2,
  Clock,
  Video,
  Layers,
  Flame,
  Coffee,
  History,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ClientWorkoutTracker({ workout, client, user }) {
  const [activeTab, setActiveTab] = useState('workout'); // 'workout' | 'history'
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [activeLog, setActiveLog] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef(null);

  // Set inputs state keyed by `${exerciseIndex}_${setNumber}`: { weight, reps, rpe, completed, logId }
  const [setInputs, setSetInputs] = useState({});
  const [savingSet, setSavingSet] = useState({});

  // Finish modal
  const [finishModalOpen, setFinishModalOpen] = useState(false);
  const [sessionNotes, setSessionNotes] = useState('');
  const [completedSummary, setCompletedSummary] = useState(null);

  // Video Modal
  const [videoModalExercise, setVideoModalExercise] = useState(null);

  // Workout History
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const days = workout?.days || [];
  const currentDay = days[activeDayIdx] || null;

  // Timer effect when workout is active
  useEffect(() => {
    if (activeLog) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeLog]);

  // Load history when switching to history tab
  useEffect(() => {
    if (activeTab === 'history' && client?.id) {
      loadHistory();
    }
  }, [activeTab, client?.id]);

  const loadHistory = async () => {
    try {
      setLoadingHistory(true);
      const data = await WorkoutsService.getClientWorkoutHistory(client.id);
      setHistory(data || []);
    } catch (err) {
      console.error('Failed to load workout history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const formatTimer = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Start workout session
  const handleStartWorkout = async () => {
    if (!client?.id) return;
    try {
      const log = await WorkoutsService.startWorkoutLog({
        workspace_id: client.workspace_id,
        client_id: client.id,
        workout_plan_id: workout?.id,
        workout_day_id: currentDay?.id,
        session_name: currentDay?.day_name || `Session ${activeDayIdx + 1}`,
      });
      setActiveLog(log);
      setElapsedSeconds(0);
      setCompletedSummary(null);

      // Pre-fill default inputs from prescribed values
      const initialInputs = {};
      (currentDay?.exercises || []).forEach((ex, exIdx) => {
        const numSets = Number(ex.sets) || 3;
        for (let s = 1; s <= numSets; s++) {
          const key = `${exIdx}_${s}`;
          // parse default reps if simple integer
          const defaultReps = parseInt(ex.rep_range, 10) || null;
          initialInputs[key] = {
            weight: ex.target_weight || '',
            reps: defaultReps || '',
            rpe: ex.rpe || '',
            completed: false,
          };
        }
      });
      setSetInputs(initialInputs);
    } catch (err) {
      console.error('Failed to start workout log:', err);
      alert('Could not start workout session. Please try again.');
    }
  };

  // Log or toggle a set
  const handleToggleSet = async (ex, exIdx, setNumber) => {
    const key = `${exIdx}_${setNumber}`;
    const current = setInputs[key] || {};
    const willBeCompleted = !current.completed;

    // optimistic UI
    setSetInputs((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        completed: willBeCompleted,
      },
    }));

    if (!activeLog) return;

    try {
      setSavingSet((prev) => ({ ...prev, [key]: true }));
      const logged = await WorkoutsService.logSet({
        workout_log_id: activeLog.id,
        workout_exercise_id: ex.id || null,
        exercise_id: ex.exercise_id || null,
        exercise_name: ex.exercise_name || ex.name || 'Exercise',
        set_number: setNumber,
        is_warmup: !!ex.warmup,
        weight_kg: current.weight ? Number(current.weight) : null,
        reps_completed: current.reps ? Number(current.reps) : null,
        rpe: current.rpe ? Number(current.rpe) : null,
        completed: willBeCompleted,
      });

      setSetInputs((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          logId: logged.id,
          completed: willBeCompleted,
        },
      }));
    } catch (err) {
      console.error('Failed to save set log:', err);
      // revert optimistic update
      setSetInputs((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          completed: !willBeCompleted,
        },
      }));
    } finally {
      setSavingSet((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleInputChange = (exIdx, setNumber, field, val) => {
    const key = `${exIdx}_${setNumber}`;
    setSetInputs((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [field]: val,
      },
    }));
  };

  // Finish workout session
  const handleFinishWorkout = async () => {
    if (!activeLog) return;
    try {
      const completedSetsCount = Object.values(setInputs).filter((s) => s.completed).length;
      await WorkoutsService.completeWorkoutLog(activeLog.id, {
        duration_seconds: elapsedSeconds,
        notes: sessionNotes || null,
        status: 'completed',
      });

      setCompletedSummary({
        sessionName: activeLog.session_name,
        duration: formatTimer(elapsedSeconds),
        setsCompleted: completedSetsCount,
      });

      setActiveLog(null);
      setFinishModalOpen(false);
      setSessionNotes('');
      setSetInputs({});
    } catch (err) {
      console.error('Failed to complete workout session:', err);
      alert('Could not finish workout session. Please try again.');
    }
  };

  if (!workout) {
    return (
      <div className="surface-card p-10 text-center rounded-2xl border border-border">
        <Dumbbell className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
        <h3 className="text-base font-semibold text-foreground">No Workout Program Assigned</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Your coach has not assigned a workout program yet. Once assigned, your training days and exercise logs will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Header & Tab Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-primary" />
            <h1 className="text-title font-display font-semibold">{workout.name}</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 capitalize">
            {(workout.split_type || 'custom').replace(/_/g, ' ')} · {days.length} training {days.length === 1 ? 'session' : 'sessions'}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('workout')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5',
              activeTab === 'workout'
                ? 'bg-secondary text-foreground border border-border shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Dumbbell className="w-3.5 h-3.5" /> Active Program
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5',
              activeTab === 'history'
                ? 'bg-secondary text-foreground border border-border shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <History className="w-3.5 h-3.5" /> Log History
          </button>
        </div>
      </div>

      {activeTab === 'history' ? (
        /* History View */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <History className="w-4 h-4 text-primary" /> Past Workout Logs
            </h3>
            <span className="text-xs text-muted-foreground">{history.length} recorded sessions</span>
          </div>

          {loadingHistory ? (
            <div className="surface-card p-8 text-center text-xs text-muted-foreground">Loading workout history…</div>
          ) : history.length === 0 ? (
            <div className="surface-card p-8 text-center rounded-xl border border-border">
              <p className="text-xs text-muted-foreground">No completed workouts recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((log) => {
                const dateStr = log.performed_at
                  ? new Date(log.performed_at).toLocaleDateString(undefined, {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'Past Session';
                const durationMins = log.duration_seconds ? Math.round(log.duration_seconds / 60) : null;
                const completedSets = (log.workout_set_logs || []).filter((s) => s.completed).length;

                return (
                  <div
                    key={log.id}
                    className="surface-card p-4 rounded-xl border border-border flex items-center justify-between"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{log.session_name}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{dateStr}</p>
                      {log.notes && (
                        <p className="text-xs bg-secondary/40 p-2 rounded-md text-muted-foreground mt-2 max-w-md">
                          "{log.notes}"
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 capitalize">
                        {log.status || 'Completed'}
                      </span>
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        {durationMins ? `${durationMins}m · ` : ''}{completedSets} sets
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Active Program / Logging View */
        <div className="space-y-4">
          {/* Celebratory Completion Alert */}
          {completedSummary && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-emerald-400">Workout Completed!</h4>
                  <p className="text-xs text-muted-foreground">
                    Logged {completedSummary.setsCompleted} sets for {completedSummary.sessionName} in {completedSummary.duration}. Great work!
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setCompletedSummary(null)}>
                Dismiss
              </Button>
            </div>
          )}

          {/* Active Workout Session Floating / Top Banner */}
          {activeLog && (
            <div className="sticky top-2 z-20 p-3.5 rounded-xl bg-primary/10 border border-primary/30 shadow-lg backdrop-blur-md flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary animate-pulse">
                  <Flame className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <span>{activeLog.session_name}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/20 text-primary font-mono">IN PROGRESS</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-primary font-mono font-medium">
                    <Clock className="w-3 h-3" />
                    <span>{formatTimer(elapsedSeconds)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => setFinishModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
                >
                  <Check className="w-3.5 h-3.5" /> Finish Workout
                </Button>
              </div>
            </div>
          )}

          {/* Day Selector Pills */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((d, idx) => {
              const isSelected = activeDayIdx === idx;
              return (
                <button
                  key={d.id || idx}
                  onClick={() => setActiveDayIdx(idx)}
                  className={cn(
                    'px-3.5 py-2 rounded-xl text-xs font-medium transition-all text-left whitespace-nowrap border shrink-0',
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-secondary/40 text-muted-foreground border-border hover:text-foreground hover:bg-secondary'
                  )}
                >
                  <div className="font-semibold">{d.day_name || `Day ${idx + 1}`}</div>
                  <div className="text-[10px] opacity-80">
                    {d.rest_day ? 'Rest & Recovery' : `${d.exercises?.length || 0} exercises`}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Current Day View */}
          {currentDay && (
            <div className="space-y-4">
              {currentDay.rest_day ? (
                /* Rest Day Card */
                <div className="surface-card p-8 rounded-2xl border border-border text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mx-auto text-primary">
                    <Coffee className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">Scheduled Rest & Recovery</h3>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Rest days are when adaptation and muscle growth occur. Focus on adequate hydration, quality nutrition, sleep, and light mobility work.
                  </p>
                  {currentDay.session_notes && (
                    <div className="text-xs bg-secondary/30 p-3 rounded-xl border border-border/50 max-w-md mx-auto text-muted-foreground text-left">
                      <span className="font-semibold text-foreground block mb-1">Coach Notes:</span>
                      {currentDay.session_notes}
                    </div>
                  )}
                </div>
              ) : (
                /* Training Session Card */
                <div className="space-y-4">
                  {/* Session Header Card */}
                  <div className="surface-card p-4 rounded-xl border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{currentDay.day_name || `Session ${activeDayIdx + 1}`}</h3>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1 font-mono">
                          <Layers className="w-3.5 h-3.5 text-primary" /> {currentDay.exercises?.length || 0} exercises
                        </span>
                        <span>·</span>
                        <span className="font-mono">
                          {currentDay.exercises?.reduce((acc, ex) => {
                            if (ex.warmup) return acc;
                            if (ex.working_sets !== undefined) return acc + (Number(ex.working_sets) || 0);
                            return acc + (Number(ex.sets) || 0);
                          }, 0)} working sets
                        </span>
                      </div>
                      {currentDay.session_notes && (
                        <p className="text-xs text-muted-foreground mt-2 bg-secondary/30 p-2 rounded-md border border-border/40">
                          {currentDay.session_notes}
                        </p>
                      )}
                    </div>

                    {!activeLog && (
                      <Button onClick={handleStartWorkout} className="shrink-0">
                        <Play className="w-4 h-4 fill-current" /> Start This Workout
                      </Button>
                    )}
                  </div>

                  {/* Exercises List */}
                  <div className="space-y-4">
                    {(currentDay.exercises || []).map((ex, exIdx) => {
                      const setsCount = Number(ex.sets) || 3;
                      const setsList = Array.from({ length: setsCount }, (_, i) => i + 1);

                      return (
                        <div
                          key={ex.id || exIdx}
                          className="surface-card rounded-xl border border-border overflow-hidden"
                        >
                          {/* Exercise Card Header */}
                          <div className="p-4 border-b border-border/50 flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center text-xs font-mono font-semibold text-muted-foreground shrink-0 mt-0.5">
                                {exIdx + 1}
                              </div>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="text-sm font-semibold text-foreground">
                                    {ex.exercise_name || ex.name || 'Exercise'}
                                  </h4>
                                  {ex.category && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground border border-border/40 capitalize">
                                      {ex.category}
                                    </span>
                                  )}
                                  {ex.warmup && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                      Warmup
                                    </span>
                                  )}
                                </div>

                                {/* Prescribed targets summary */}
                                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap font-mono">
                                  <span>{ex.sets || 3} sets × {ex.rep_range || '8-12'} reps</span>
                                  {ex.rpe && <span>· Target RPE {ex.rpe}</span>}
                                  {ex.rest_seconds && <span>· {ex.rest_seconds}s rest</span>}
                                </div>

                                {ex.notes && (
                                  <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                                    Coach: "{ex.notes}"
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Video Demo Button */}
                            {ex.video_url && (
                              <button
                                type="button"
                                onClick={() => setVideoModalExercise(ex)}
                                className="px-2.5 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary text-xs text-primary font-medium flex items-center gap-1.5 border border-border transition-colors shrink-0"
                              >
                                <Video className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Watch Demo</span>
                              </button>
                            )}
                          </div>

                          {/* Interactive Set Table */}
                          <div className="p-3 bg-secondary/10">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted-foreground border-b border-border/30 text-[11px]">
                                    <th className="py-2 text-left font-medium w-12">SET</th>
                                    <th className="py-2 text-left font-medium">PRESCRIBED</th>
                                    <th className="py-2 text-center font-medium w-24">KG</th>
                                    <th className="py-2 text-center font-medium w-24">REPS</th>
                                    <th className="py-2 text-center font-medium w-20">RPE</th>
                                    <th className="py-2 text-center font-medium w-14">✓</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border/20">
                                  {setsList.map((setNum) => {
                                    const key = `${exIdx}_${setNum}`;
                                    const state = setInputs[key] || {};
                                    const isCompleted = !!state.completed;

                                    return (
                                      <tr
                                        key={setNum}
                                        className={cn(
                                          'transition-colors',
                                          isCompleted ? 'bg-emerald-500/5' : 'hover:bg-secondary/20'
                                        )}
                                      >
                                        <td className="py-2">
                                          <span
                                            className={cn(
                                              'inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-mono font-semibold',
                                              isCompleted
                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                : 'bg-secondary text-muted-foreground'
                                            )}
                                          >
                                            {ex.warmup ? 'W' : setNum}
                                          </span>
                                        </td>
                                        <td className="py-2 font-mono text-muted-foreground text-[11px]">
                                          {ex.rep_range || '8-12'} reps {ex.rpe ? `@ RPE ${ex.rpe}` : ''}
                                        </td>
                                        <td className="py-2 px-1 text-center">
                                          <input
                                            type="number"
                                            placeholder="—"
                                            value={state.weight ?? ''}
                                            onChange={(e) => handleInputChange(exIdx, setNum, 'weight', e.target.value)}
                                            disabled={!activeLog}
                                            className={cn(
                                              'w-20 h-7 text-center rounded-md font-mono text-xs border transition-colors focus:outline-none focus:border-primary',
                                              isCompleted
                                                ? 'bg-background/40 border-emerald-500/30 text-emerald-400'
                                                : 'bg-secondary/50 border-border'
                                            )}
                                          />
                                        </td>
                                        <td className="py-2 px-1 text-center">
                                          <input
                                            type="number"
                                            placeholder="—"
                                            value={state.reps ?? ''}
                                            onChange={(e) => handleInputChange(exIdx, setNum, 'reps', e.target.value)}
                                            disabled={!activeLog}
                                            className={cn(
                                              'w-20 h-7 text-center rounded-md font-mono text-xs border transition-colors focus:outline-none focus:border-primary',
                                              isCompleted
                                                ? 'bg-background/40 border-emerald-500/30 text-emerald-400'
                                                : 'bg-secondary/50 border-border'
                                            )}
                                          />
                                        </td>
                                        <td className="py-2 px-1 text-center">
                                          <input
                                            type="number"
                                            step="0.5"
                                            min="5"
                                            max="10"
                                            placeholder="—"
                                            value={state.rpe ?? ''}
                                            onChange={(e) => handleInputChange(exIdx, setNum, 'rpe', e.target.value)}
                                            disabled={!activeLog}
                                            className={cn(
                                              'w-16 h-7 text-center rounded-md font-mono text-xs border transition-colors focus:outline-none focus:border-primary',
                                              isCompleted
                                                ? 'bg-background/40 border-emerald-500/30 text-emerald-400'
                                                : 'bg-secondary/50 border-border'
                                            )}
                                          />
                                        </td>
                                        <td className="py-2 text-center">
                                          <button
                                            type="button"
                                            onClick={() => handleToggleSet(ex, exIdx, setNum)}
                                            disabled={!activeLog || savingSet[key]}
                                            className={cn(
                                              'w-7 h-7 rounded-md flex items-center justify-center transition-all mx-auto',
                                              isCompleted
                                                ? 'bg-emerald-500 text-white shadow-sm'
                                                : activeLog
                                                ? 'bg-secondary hover:bg-secondary/80 text-muted-foreground border border-border'
                                                : 'bg-secondary/30 text-muted-foreground/40 cursor-not-allowed'
                                            )}
                                            title={isCompleted ? 'Mark uncompleted' : 'Mark set completed'}
                                          >
                                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {!activeLog && (
                              <p className="text-[11px] text-muted-foreground/70 text-center pt-2">
                                Click "Start This Workout" above to enable live set tracking.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Video Demonstration Modal */}
      {videoModalExercise && (
        <ExerciseVideoModal
          open={!!videoModalExercise}
          onClose={() => setVideoModalExercise(null)}
          exerciseName={videoModalExercise.exercise_name || videoModalExercise.name}
          videoUrl={videoModalExercise.video_url}
          instructions={videoModalExercise.notes}
        />
      )}

      {/* Finish Session Confirmation Modal */}
      <Modal
        open={finishModalOpen}
        onClose={() => setFinishModalOpen(false)}
        title="Finish Workout Session"
        size="md"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-secondary/40 border border-border flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Session Duration</span>
              <span className="text-lg font-mono font-semibold text-primary">{formatTimer(elapsedSeconds)}</span>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted-foreground block">Sets Completed</span>
              <span className="text-lg font-mono font-semibold text-foreground">
                {Object.values(setInputs).filter((s) => s.completed).length}
              </span>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">
              Session Feedback / Notes (Optional)
            </label>
            <textarea
              rows={3}
              placeholder="How did this workout feel? (e.g., strong bench press, right shoulder felt tight...)"
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              className="w-full p-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/40 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setFinishModalOpen(false)}>
              Keep Training
            </Button>
            <Button onClick={handleFinishWorkout} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              <Check className="w-4 h-4" /> Complete & Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
