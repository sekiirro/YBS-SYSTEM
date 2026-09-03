import React, { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { WorkoutsService } from '@/services/workouts';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Button } from '@/components/ui';
import { Dumbbell, Search, Plus } from 'lucide-react';

export default function WorkoutPlans() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('client');
  const isTrainer = user?.role === 'trainer';

  useEffect(() => { loadPlans(); }, [view]);

  const loadPlans = async () => {
    try {
      setLoading(true);
      const data = await WorkoutsService.list({ is_template: view === 'template' });
      setPlans(data);
    } catch (err) {
      console.error(err);
    } finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    return plans.filter((p) => !search || p.name?.toLowerCase().includes(search.toLowerCase()));
  }, [plans, search]);

  if (loading) return <LoadingState label="Loading workout plans…" />;

  return (
    <div>
      <PageHeader
        title="Workout Plans"
        description="Training programs and templates"
        icon={Dumbbell}
        actions={hasPermission(user, 'workout.create') && <Button><Plus className="w-4 h-4" /> New Plan</Button>}
      />
      <div className="flex gap-2 mb-4">
        <button onClick={() => setView('client')} className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${view === 'client' ? 'bg-secondary text-foreground border border-border' : 'text-muted-foreground hover:text-foreground'}`}>Client Plans</button>
        <button onClick={() => setView('template')} className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${view === 'template' ? 'bg-secondary text-foreground border border-border' : 'text-muted-foreground hover:text-foreground'}`}>Templates</button>
      </div>
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Search plans…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40" />
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={Dumbbell} title="No workout plans" description="Create workout plans for your clients" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div key={p.id} className="surface-card p-5 hover:glow-subtle transition-all">
              <h3 className="text-[14px] font-medium">{p.name}</h3>
              {p.client_name && <p className="text-[11px] text-muted-foreground mt-0.5">{p.client_name}</p>}
              <p className="text-[11px] text-muted-foreground mt-2 capitalize">{p.split_type?.replace('_', ' ')} · {p.days?.length || 0} days</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}