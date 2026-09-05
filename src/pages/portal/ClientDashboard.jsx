import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { ClientsService } from '@/services/clients';
import { SubscriptionsService } from '@/services/subscriptions';
import { WorkoutsService } from '@/services/workouts';
import { NutritionService } from '@/services/nutrition';
import { MetricsService } from '@/services/metrics';
import { AssessmentsService } from '@/services/assessments';
import { supabase } from '@/utils/supabase';

import ClientDashboardHeader from '@/components/portal/ClientDashboardHeader';
import TodayFocus from '@/components/portal/TodayFocus';
import WeightProgressChart from '@/components/portal/WeightProgressChart';
import ClientConsistencyCard from '@/components/portal/ClientConsistencyCard';
import ClientPackageCard from '@/components/portal/ClientPackageCard';
import FormFiller from '@/components/FormFiller';
import { LoadingState } from '@/components/ui';
import { getLocalDateKey } from '@/lib/ybs-utils';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import { Apple, Dumbbell, ArrowRight, ClipboardCheck } from 'lucide-react';

const planStatusStyle = (status) => {
  switch (status) {
    case 'active':
      return 'bg-primary/10 text-primary border-primary/20';
    case 'paused':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    default:
      return 'bg-secondary text-muted-foreground border-border/80';
  }
};

export default function ClientDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [subscription, setSubscription] = useState(null);
  const [workout, setWorkout] = useState(null);
  const [nutrition, setNutrition] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [forms, setForms] = useState([]);
  const [todayWorkoutLog, setTodayWorkoutLog] = useState(null);
  const [workoutLogs, setWorkoutLogs] = useState([]);
  const [todayNutritionLog, setTodayNutritionLog] = useState(null);
  const [weeklyNutritionLogs, setWeeklyNutritionLogs] = useState([]);
  const [activeForm, setActiveForm] = useState(null);

  const loadPortalData = useCallback(async () => {
    if (!user?.self_client_id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const clientId = user.self_client_id;
      const todayStr = getLocalDateKey();

      // 1. Load client profile & active workspace
      const c = await ClientsService.getById(clientId);
      setClient(c);

      if (c?.workspace_id) {
        supabase
          .from('workspaces')
          .select('name')
          .eq('id', c.workspace_id)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.name) setWorkspaceName(data.name);
          })
          .catch(() => {});
      }

      // 2. Parallel client-scoped queries
      const [
        subs,
        wps,
        nps,
        metList,
        formList,
        wLogs,
        todayNutri,
        weekNutri,
      ] = await Promise.all([
        SubscriptionsService.list({ client_id: clientId }).catch(() => []),
        WorkoutsService.list({ client_id: clientId }).catch(() => []),
        NutritionService.list({ client_id: clientId }).catch(() => []),
        MetricsService.listByClient(clientId).catch(() => []),
        AssessmentsService.list({ client_id: clientId }).catch(() => []),
        WorkoutsService.getClientWorkoutHistory(clientId, 30).catch(() => []),
        NutritionService.getDailyNutritionLog(clientId, todayStr).catch(() => null),
        NutritionService.getWeeklyNutritionLogs(clientId).catch(() => []),
      ]);

      const activeSub = (subs || []).find((s) => s.status === 'active') || subs[0] || null;
      setSubscription(activeSub);
      setWorkout(wps[0] || null);
      setNutrition(nps[0] || null);
      setMetrics(metList || []);
      setForms(formList || []);
      setWorkoutLogs(wLogs || []);

      // Check if today's workout has been logged as completed
      const todayW = (wLogs || []).find((l) => {
        const logDate = getLocalDateKey(l.performed_at || l.created_at);
        return logDate === todayStr && l.status === 'completed';
      });
      setTodayWorkoutLog(todayW || null);

      setTodayNutritionLog(todayNutri);
      setWeeklyNutritionLogs(weekNutri || []);
    } catch (err) {
      console.error('Error loading client dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadPortalData();
  }, [loadPortalData]);

  // Handle meal logging click from TodayNutritionCard
  const handleLogMeals = async () => {
    if (!client?.id) return;
    const todayStr = getLocalDateKey();
    const log = await NutritionService.logDailyMeals({
      clientId: client.id,
      workspaceId: client.workspace_id,
      nutritionPlanId: nutrition?.id || null,
      date: todayStr,
      mealsCompleted: true,
    });
    // Re-fetch authoritative DB state after a successful write. If the
    // refetch fails, keep the upsert result (it was confirmed by the DB).
    try {
      const [freshToday, freshWeek] = await Promise.all([
        NutritionService.getDailyNutritionLog(client.id, todayStr),
        NutritionService.getWeeklyNutritionLogs(client.id),
      ]);
      setTodayNutritionLog(freshToday);
      setWeeklyNutritionLogs(freshWeek || []);
    } catch (err) {
      setTodayNutritionLog(log);
      setWeeklyNutritionLogs((prev) => [log, ...prev.filter((l) => l.log_date !== todayStr)]);
      console.error('Meal log saved, but dashboard refresh failed:', err);
    }
  };

  // Open form in interactive filler
  const handleOpenForm = async (f) => {
    try {
      const full = await AssessmentsService.getById(f.id);
      setActiveForm(full);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveForm = async (assessmentId, responses) => {
    await AssessmentsService.saveResponses(assessmentId, responses);
    const full = await AssessmentsService.getById(assessmentId);
    setActiveForm(full);
  };

  const handleSubmitForm = async (assessmentId, responses) => {
    await AssessmentsService.submitForm(assessmentId, responses, {
      clientUserId: user.id,
      coachUserId: activeForm?.assigned_ybs_coach_id,
      workspaceId: activeForm?.workspace_id,
      formName: activeForm?.name,
    });
    const formList = await AssessmentsService.list({ client_id: user.self_client_id });
    setForms(formList);
    setActiveForm(null);
  };

  if (loading) {
    return <LoadingState label="Loading your coaching dashboard…" />;
  }

  if (!client) {
    return (
      <div className="surface-card p-12 text-center rounded-xl border border-border">
        <h2 className="text-lg font-semibold text-foreground font-display">Client Profile Not Linked</h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
          Your account is authenticated, but not yet linked to an active client roster profile in this workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* 1. Dynamic Greeting Header */}
      <ClientDashboardHeader client={client} workspaceName={workspaceName} />

      {/* 2. Today's Focus (Workout, Nutrition, Forms) */}
      <TodayFocus
        workout={workout}
        nutrition={nutrition}
        forms={forms}
        todayWorkoutLog={todayWorkoutLog}
        todayNutritionLog={todayNutritionLog}
        onStartWorkout={() => navigate('/portal/exercise')}
        onLogMeals={handleLogMeals}
        onOpenForm={handleOpenForm}
      />

      {/* 3. Your Plans Quick Glance */}
      <div>
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display">
            Your Active Programs
          </h2>
        </div>

        {!nutrition && !workout ? (
          <ClientEmptyState
            icon={ClipboardCheck}
            title="No Programs Assigned Yet"
            description="Your coach has not assigned your nutrition or training programs yet. They will appear here as soon as they are published to your account."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Active Nutrition Plan Card */}
            {nutrition && (
              <div className="surface-card p-5 rounded-xl border border-border/80 flex flex-col justify-between glow-subtle">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Apple className="w-3.5 h-3.5 text-primary" /> Nutrition Plan
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${planStatusStyle(nutrition.status)}`}>
                      {(nutrition.status || 'active').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground font-display">
                    {nutrition.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {nutrition.daily_calories
                      ? `${Math.round(nutrition.daily_calories)} kcal/day · ${nutrition.meals?.length || 0} meals`
                      : nutrition.meals?.length
                        ? `${nutrition.meals.length} meals`
                        : 'Nutrition program assigned'}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/40">
                  <Link to="/portal/nutrition" className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
                    View meal details <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            )}

            {/* Active Workout Plan Card */}
            {workout && (
              <div className="surface-card p-5 rounded-xl border border-border/80 flex flex-col justify-between glow-subtle">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Dumbbell className="w-3.5 h-3.5 text-primary" /> Workout Plan
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${planStatusStyle(workout.status)}`}>
                      {(workout.status || 'active').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground font-display">
                    {workout.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 capitalize">
                    {workout.split_type
                      ? `${workout.split_type.replace(/_/g, ' ')} · ${workout.days?.length || 0} sessions/week`
                      : workout.days?.length
                        ? `${workout.days.length} sessions/week`
                        : 'Training program assigned'}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/40">
                  <Link to="/portal/exercise" className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
                    View training plan <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Weight Progress Chart & Analysis */}
      <div>
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display">
            Your Progress
          </h2>
          <Link to="/portal/metrics" className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
            All Metrics <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <WeightProgressChart metrics={metrics} client={client} />
      </div>

      {/* 5. Consistency & Streaks */}
      <div>
        <ClientConsistencyCard
          workoutLogs={workoutLogs}
          nutritionLogs={weeklyNutritionLogs}
          forms={forms}
          workoutPlan={workout}
        />
      </div>

      {/* 6. Current Package Spotlight */}
      <div>
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display">
            Your Package
          </h2>
        </div>
        <ClientPackageCard subscription={subscription} client={client} />
      </div>

      {/* Interactive Form Filler Modal */}
      {activeForm && (
        <FormFiller
          assessment={activeForm}
          onSave={handleSaveForm}
          onSubmit={handleSubmitForm}
          onClose={() => setActiveForm(null)}
        />
      )}
    </div>
  );
}
