import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { ClientsService } from '@/services/clients';
import { WorkoutsService } from '@/services/workouts';
import { NutritionService } from '@/services/nutrition';
import { AssessmentsService } from '@/services/assessments';
import { supabase } from '@/utils/supabase';

import TodayWorkoutCard from '@/components/portal/TodayWorkoutCard';
import TodayNutritionCard from '@/components/portal/TodayNutritionCard';
import TodayFormsCard from '@/components/portal/TodayFormsCard';
import ClientConsistencyCard from '@/components/portal/ClientConsistencyCard';
import CinematicPortalNav from '@/components/portal/CinematicPortalNav';
import FormFiller from '@/components/FormFiller';
import { LoadingState } from '@/components/ui';
import { getLocalDateKey } from '@/lib/ybs-utils';

import heroVideo from '../../../vid 1.mp4';

export default function ClientDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workout, setWorkout] = useState(null);
  const [nutrition, setNutrition] = useState(null);
  const [forms, setForms] = useState([]);
  const [todayWorkoutLog, setTodayWorkoutLog] = useState(null);
  const [todayNutritionLog, setTodayNutritionLog] = useState(null);
  const [workoutLogs, setWorkoutLogs] = useState([]);
  const [weeklyNutritionLogs, setWeeklyNutritionLogs] = useState([]);
  const [activeForm, setActiveForm] = useState(null);

  const videoRef = useRef(null);

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
        wps,
        nps,
        formList,
        wLogs,
        todayNutri,
        weekNutri,
      ] = await Promise.all([
        WorkoutsService.list({ client_id: clientId }).catch(() => []),
        NutritionService.list({ client_id: clientId }).catch(() => []),
        AssessmentsService.list({ client_id: clientId }).catch(() => []),
        WorkoutsService.getClientWorkoutHistory(clientId, 30).catch(() => []),
        NutritionService.getDailyNutritionLog(clientId, todayStr).catch(() => null),
        NutritionService.getWeeklyNutritionLogs(clientId).catch(() => []),
      ]);

      setWorkout(wps[0] || null);
      setNutrition(nps[0] || null);
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

  // Respect reduced-motion preferences by holding the local hero video on a
  // stable frame while preserving the same visual composition.
  useEffect(() => {
    if (loading || !client || !videoRef.current || typeof window.matchMedia !== 'function') return undefined;
    const video = videoRef.current;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPlayback = () => {
      if (motionPreference.matches) video.pause();
      else video.play().catch(() => {});
    };
    syncPlayback();
    motionPreference.addEventListener?.('change', syncPlayback);
    return () => {
      motionPreference.removeEventListener?.('change', syncPlayback);
    };
  }, [loading, client]);

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
    return (
      <div className="ybs-cine">
        <div className="ybs-cine__atmosphere" aria-hidden="true" />
        <div className="ybs-cine__state">
          <LoadingState label="Loading your coaching dashboard…" />
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="ybs-cine">
        <div className="ybs-cine__atmosphere" aria-hidden="true" />
        <div className="ybs-cine__state">
          <div>
            <h2>Client Profile Not Linked</h2>
            <p>
              Your account is authenticated, but not yet linked to an active client roster profile in this workspace.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const displayName = client.full_name?.trim() || 'Athlete';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || 'C';
  return (
    <div className="ybs-cine">
      <div className="ybs-cine__atmosphere" aria-hidden="true" />
      <CinematicPortalNav
        workspaceName={workspaceName}
        initials={initials}
        displayName={displayName}
        onSignOut={() => logout()}
      />

      <div className="ybs-cine__inner">
        <section className="ybs-cine__hero" aria-label="Today at a glance">
          <div className="ybs-cine__video-layer ybs-cine__reveal" style={{ '--cine-delay': '0s' }} aria-hidden="true">
            <video
              ref={videoRef}
              className="ybs-cine__video"
              src={heroVideo}
              autoPlay
              muted
              playsInline
              loop
              preload="auto"
              onCanPlay={(event) => event.currentTarget.classList.add('is-ready')}
            />
          </div>

          <div className="ybs-cine__identity ybs-cine__reveal" style={{ '--cine-delay': '0.05s' }}>
            <h1 className="ybs-cine__greeting">
              <span className="dim">Hey,</span>
              {displayName}.
            </h1>
            <p className="ybs-cine__motive">Your next step, made clear.</p>
          </div>

          <div className="ybs-cine__spacer" aria-hidden="true" />

          <div className="ybs-cine__rail ybs-cine__reveal" style={{ '--cine-delay': '0.25s' }}>
            <TodayWorkoutCard
              workout={workout}
              todayLog={todayWorkoutLog}
              onStartWorkout={() => navigate('/portal/exercise')}
              compact
            />
            <TodayNutritionCard
              nutrition={nutrition}
              todayLog={todayNutritionLog}
              onLogMeals={handleLogMeals}
              compact
            />
            <TodayFormsCard
              forms={forms}
              onOpenForm={handleOpenForm}
              compact
            />
          </div>
        </section>

        {/* Final section: consistency strip */}
        <section className="ybs-cine__strip-wrap ybs-cine__reveal" style={{ '--cine-delay': '0.35s' }} aria-label="Your consistency">
          <p className="ybs-cine__strip-label">Your Consistency</p>
          <div className="ybs-cine__strip">
            <ClientConsistencyCard
              workoutLogs={workoutLogs}
              nutritionLogs={weeklyNutritionLogs}
              forms={forms}
              workoutPlan={workout}
            />
          </div>
        </section>
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
