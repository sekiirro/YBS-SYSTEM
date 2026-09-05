import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { WorkoutsService } from '@/services/workouts';
import { ClientsService } from '@/services/clients';
import ClientWorkoutTracker from '@/components/workouts/ClientWorkoutTracker';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import { LoadingState } from '@/components/ui';
import { Dumbbell } from 'lucide-react';

export default function ClientExercise() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [workout, setWorkout] = useState(null);

  const loadData = useCallback(async () => {
    if (!user?.self_client_id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [c, wps] = await Promise.all([
        ClientsService.getById(user.self_client_id),
        WorkoutsService.list({ client_id: user.self_client_id }),
      ]);
      setClient(c);
      setWorkout(wps?.[0] || null);
    } catch (err) {
      console.error('Error loading client exercise plan:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.self_client_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) return <LoadingState label="Loading your exercise plan…" />;

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
          <p className="text-[13px] text-muted-foreground mt-1">
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

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="pb-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Dumbbell className="w-5 h-5 text-primary" />
          <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
            My Exercise Plan
          </h1>
        </div>
        <p className="text-[13px] text-muted-foreground mt-1">
          Perform your scheduled training, log sets with weights and reps, and build progressive overload.
        </p>
      </div>

      {/* Embedded ClientWorkoutTracker */}
      <ClientWorkoutTracker
        workout={workout}
        client={client}
        user={user}
      />
    </div>
  );
}
