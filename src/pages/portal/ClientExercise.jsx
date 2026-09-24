import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { WorkoutsService } from '@/services/workouts';
import { ClientsService } from '@/services/clients';
import ClientWorkoutTracker from '@/components/workouts/ClientWorkoutTracker';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import CinematicPortalNav from '@/components/portal/CinematicPortalNav';
import { ErrorState, LoadingState } from '@/components/ui';
import { supabase } from '@/utils/supabase';
import { Dumbbell } from 'lucide-react';

export default function ClientExercise() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [client, setClient] = useState(null);
  const [workout, setWorkout] = useState(null);
  const [workspaceName, setWorkspaceName] = useState('');

  const loadData = useCallback(async () => {
    if (!user?.self_client_id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setLoadError(false);
      const [c, wps] = await Promise.all([
        ClientsService.getById(user.self_client_id),
        WorkoutsService.list({ client_id: user.self_client_id }),
      ]);
      setClient(c);
      setWorkout(wps?.[0] || null);
    } catch (err) {
      setLoadError(true);
      console.error('Error loading client exercise plan:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.self_client_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!user?.active_workspace_id) return;
    supabase.from('workspaces').select('name').eq('id', user.active_workspace_id).maybeSingle()
      .then(({ data }) => setWorkspaceName(data?.name || '')).catch(() => {});
  }, [user?.active_workspace_id]);

  if (loading) return <LoadingState label="Loading your exercise plan…" />;

  if (loadError) return <ErrorState onRetry={loadData} />;

  if (!workout) {
    return (
      <div className="space-y-6">
        <div className="pb-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-primary" />
            <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
              My Exercise Plan
            </h1>
          </div>
          <p className="text-[14px] text-muted-foreground mt-1">
            Periodized training routines, prescribed volume, and live workout logging.
          </p>
        </div>

        <ClientEmptyState
          icon={Dumbbell}
          title="No Workout Plan Assigned Yet"
          description="Your workout plan hasn't been assigned yet. Your coach will publish your split and exercises here."
        />
      </div>
    );
  }

  const displayName = user?.full_name?.trim() || 'Athlete';
  const initials = displayName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'C';

  return (
    <div className="workout-cinema ybs-cine animate-in fade-in duration-300">
      <CinematicPortalNav workspaceName={workspaceName} initials={initials} displayName={displayName} onSignOut={() => logout()} warmActive />
      <div className="workout-cinema__glow" aria-hidden="true" />
      <main className="workout-cinema__content">
        <p className="workout-cinema__eyebrow">Training protocol</p>
        <ClientWorkoutTracker workout={workout} client={client} user={user} />
      </main>
    </div>
  );
}
