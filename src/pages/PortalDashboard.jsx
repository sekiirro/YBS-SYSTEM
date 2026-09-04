import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { ClientsService } from '@/services/clients';
import { SubscriptionsService } from '@/services/subscriptions';
import { WorkoutsService } from '@/services/workouts';
import { NutritionService } from '@/services/nutrition';
import { MetricsService } from '@/services/metrics';
import { AssessmentsService } from '@/services/assessments';
import { NotificationsService } from '@/services/notifications';
import { LoadingState, Badge, Button } from '@/components/ui';
import { formatDate, getSubscriptionStatusColor, getFormStatusColor, daysUntil } from '@/lib/ybs-utils';
import { Dumbbell, Apple, TrendingUp, ClipboardList, CreditCard, Bell, User, Calendar, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import FormFiller from '@/components/FormFiller';

export default function PortalDashboard({ view = 'dashboard' }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [allSubscriptions, setAllSubscriptions] = useState([]);
  const [workout, setWorkout] = useState(null);
  const [nutrition, setNutrition] = useState(null);
  const [allNutritionPlans, setAllNutritionPlans] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [forms, setForms] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [activeForm, setActiveForm] = useState(null);

  useEffect(() => {
    (async () => {
      if (!user?.self_client_id) { setLoading(false); return; }
      try {
        const c = await ClientsService.getById(user.self_client_id);
        setClient(c);
        const [subs, wps, nps, metList, formList, notifs] = await Promise.all([
          SubscriptionsService.list({ client_id: user.self_client_id }).catch(() => []),
          WorkoutsService.list({ client_id: user.self_client_id }).catch(() => []),
          NutritionService.list({ client_id: user.self_client_id }).catch(() => []),
          MetricsService.listByClient(user.self_client_id).catch(() => []),
          AssessmentsService.list({ client_id: user.self_client_id }).catch(() => []),
          NotificationsService.list(user.id).catch(() => []),
        ]);
        setAllSubscriptions(subs);
        setSubscription(subs.find(s => s.status === 'active') || subs[0] || null);
        setWorkout(wps[0] || null);
        setAllNutritionPlans(nps || []);
        setNutrition(nps[0] || null);
        setMetrics(metList);
        setForms(formList);
        setNotifications(notifs);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [user]);

  if (loading) return <LoadingState label="Loading your portal…" />;
  if (!client) return <div className="text-center py-16 text-muted-foreground text-[13px]">Your client profile is not linked yet.</div>;

  const days = subscription ? daysUntil(subscription.end_date) : null;
  const latestMetric = metrics[0] || null;
  const pendingForm = forms.find(f => f.submission_status === 'pending') || null;

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

  // Render view-specific content
  if (view === 'workout') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Dumbbell className="w-5 h-5 text-primary" />
          <h1 className="text-title font-display font-semibold">My Workout Plan</h1>
        </div>
        {workout ? (
          <div className="surface-card p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{workout.name}</h2>
              <p className="text-sm text-muted-foreground capitalize">{workout.split_type?.replace(/_/g, ' ')} · {workout.days?.length || 0} training days</p>
            </div>
            {workout.notes && <p className="text-xs bg-secondary/50 p-3 rounded-md text-muted-foreground">{workout.notes}</p>}
            <div className="space-y-3">
              {(workout.days || []).map((day, idx) => (
                <div key={idx} className="border border-border/70 rounded-lg p-4 bg-secondary/20">
                  <h3 className="text-sm font-semibold text-primary">{day.name || `Day ${idx + 1}`}</h3>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {(day.exercises || []).map((ex, exIdx) => (
                      <div key={exIdx} className="flex justify-between py-1 border-b border-border/40 last:border-0">
                        <span className="font-medium text-foreground">{ex.name || 'Exercise'}</span>
                        <span>{ex.sets || 3} sets × {ex.reps || 10} reps {ex.rest_seconds ? `(${ex.rest_seconds}s rest)` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="surface-card p-10 text-center text-muted-foreground">No workout plan assigned yet. Your coach will update this soon.</div>
        )}
      </div>
    );
  }

  if (view === 'nutrition') {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Apple className="w-5 h-5 text-primary" />
            <h1 className="text-title font-display font-semibold">My Nutrition Plan</h1>
          </div>

          {allNutritionPlans.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Plan:</span>
              <select
                value={nutrition?.id}
                onChange={(e) => {
                  const selected = allNutritionPlans.find((p) => p.id === e.target.value);
                  if (selected) setNutrition(selected);
                }}
                className="h-8 px-2.5 rounded-md bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/40 text-foreground"
              >
                {allNutritionPlans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {nutrition ? (
          <div className="surface-card p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{nutrition.name}</h2>
              <p className="text-sm text-muted-foreground">
                {nutrition.daily_calories ? `${Math.round(nutrition.daily_calories)} kcal/day` : ''} · {nutrition.meals?.length || 0} meals
              </p>
            </div>

            {nutrition.notes && (
              <p className="text-xs bg-secondary/50 p-3 rounded-md text-muted-foreground border border-border/40">
                {nutrition.notes}
              </p>
            )}

            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-secondary/40 p-2.5 rounded-lg border border-border/30">
                <p className="text-[10px] text-muted-foreground uppercase">Calories</p>
                <p className="text-sm font-semibold text-primary">{Math.round(nutrition.daily_calories || 0)} kcal</p>
              </div>
              <div className="bg-secondary/40 p-2.5 rounded-lg border border-border/30">
                <p className="text-[10px] text-muted-foreground uppercase">Protein</p>
                <p className="text-sm font-semibold text-foreground">{nutrition.daily_protein != null ? `${nutrition.daily_protein}g` : '—'}</p>
              </div>
              <div className="bg-secondary/40 p-2.5 rounded-lg border border-border/30">
                <p className="text-[10px] text-muted-foreground uppercase">Carbs</p>
                <p className="text-sm font-semibold text-foreground">{nutrition.daily_carbs != null ? `${nutrition.daily_carbs}g` : '—'}</p>
              </div>
              <div className="bg-secondary/40 p-2.5 rounded-lg border border-border/30">
                <p className="text-[10px] text-muted-foreground uppercase">Fats</p>
                <p className="text-sm font-semibold text-foreground">{nutrition.daily_fat != null ? `${nutrition.daily_fat}g` : '—'}</p>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              {(nutrition.meals || []).map((meal, idx) => (
                <div key={idx} className="border border-border/70 rounded-lg p-4 bg-secondary/20 space-y-2">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-semibold text-primary">{meal.meal_name || meal.name || `Meal ${idx + 1}`}</h3>
                    {meal.calories != null && (
                      <span className="text-xs font-mono text-muted-foreground">{Math.round(meal.calories)} kcal</span>
                    )}
                  </div>
                  {meal.notes && (
                    <p className="text-[11px] text-muted-foreground italic">{meal.notes}</p>
                  )}
                  <div className="space-y-1 text-xs text-muted-foreground pt-1">
                    {(meal.items || []).map((it, itIdx) => (
                      <div key={itIdx} className="flex justify-between items-center py-1.5 border-b border-border/40 last:border-0">
                        <span className="text-foreground font-medium">{it.food_name || it.name || 'Food Item'}</span>
                        <div className="flex items-center gap-3 font-mono">
                          <span>{it.amount} {it.unit}</span>
                          {it.calories != null && (
                            <span className="text-primary/90 font-semibold">{Math.round(it.calories)} kcal</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="surface-card p-10 text-center text-muted-foreground">No nutrition plan assigned yet. Your coach will update this soon.</div>
        )}
      </div>
    );
  }

  if (view === 'progress') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h1 className="text-title font-display font-semibold">My Progress</h1>
        </div>
        {metrics.length > 0 ? (
          <div className="surface-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase text-muted-foreground">Weight</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase text-muted-foreground">Body Fat</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase text-muted-foreground">Waist</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase text-muted-foreground">Notes</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.id} className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="px-4 py-3 text-xs font-medium">{formatDate(m.entry_date)}</td>
                    <td className="px-4 py-3 text-xs">{m.weight ? `${m.weight} kg` : '—'}</td>
                    <td className="px-4 py-3 text-xs">{m.body_fat ? `${m.body_fat}%` : '—'}</td>
                    <td className="px-4 py-3 text-xs">{m.waist ? `${m.waist} cm` : '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{m.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="surface-card p-10 text-center text-muted-foreground">No progress entries recorded yet.</div>
        )}
      </div>
    );
  }

  if (view === 'assessments') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <ClipboardList className="w-5 h-5 text-primary" />
          <h1 className="text-title font-display font-semibold">My Forms & Check-ins</h1>
        </div>
        {forms.length > 0 ? (
          <div className="space-y-3">
            {forms.map((f) => (
              <div key={f.id} className="surface-card p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{f.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Due: {formatDate(f.due_date)} · Status: <span className="capitalize">{f.submission_status}</span></p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className={cn(getFormStatusColor(f.submission_status), 'capitalize')}>
                    {f.submission_status}
                  </Badge>
                  <Button
                    variant={f.submission_status === 'submitted' ? 'ghost' : 'default'}
                    size="sm"
                    onClick={() => handleOpenForm(f)}
                  >
                    {f.submission_status === 'submitted' ? 'View Answers' : 'Fill Out'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface-card p-10 text-center text-muted-foreground">No forms scheduled at this time.</div>
        )}

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

  if (view === 'subscription') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <h1 className="text-title font-display font-semibold">My Subscription</h1>
        </div>
        {allSubscriptions.length > 0 ? (
          <div className="space-y-3">
            {allSubscriptions.map((s) => (
              <div key={s.id} className="surface-card p-5">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-semibold">{s.package_name || 'Coaching Subscription'}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(s.start_date)} → {formatDate(s.end_date)}</p>
                  </div>
                  <Badge className={cn(getSubscriptionStatusColor(s.status), 'capitalize')}>{s.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface-card p-10 text-center text-muted-foreground">No subscription records found.</div>
        )}
      </div>
    );
  }

  if (view === 'notifications') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Bell className="w-5 h-5 text-primary" />
          <h1 className="text-title font-display font-semibold">Notifications</h1>
        </div>
        {notifications.length > 0 ? (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className={cn('p-4 rounded-lg border surface-card', n.is_read ? 'opacity-80' : 'border-primary/25')}>
                <h4 className="text-sm font-semibold">{n.title}</h4>
                <p className="text-xs text-muted-foreground mt-1">{n.message}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-2">{formatDate(n.created_date)}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface-card p-10 text-center text-muted-foreground">No notifications.</div>
        )}
      </div>
    );
  }

  if (view === 'profile') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <User className="w-5 h-5 text-primary" />
          <h1 className="text-title font-display font-semibold">My Profile</h1>
        </div>
        <div className="surface-card p-6 space-y-4 max-w-lg">
          <div className="flex items-center gap-3 pb-4 border-b border-border">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary text-lg">
              {client.full_name?.[0] || 'C'}
            </div>
            <div>
              <p className="font-semibold">{client.full_name}</p>
              <p className="text-xs text-muted-foreground font-mono">{client.client_code}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Phone</span>
              <p className="font-medium mt-0.5">{client.phone || '—'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Email</span>
              <p className="font-medium mt-0.5">{client.email || '—'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Follow-up Day</span>
              <p className="font-medium mt-0.5 capitalize">{client.follow_up_day || '—'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Assigned Coach</span>
              <p className="font-medium mt-0.5">{client.assigned_ybs_coach_name || 'YBS Team'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default Overview Dashboard
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title font-display font-semibold tracking-tight">Welcome, {client.full_name?.split(' ')[0]}</h1>
        <p className="text-[13px] text-muted-foreground mt-1 font-mono">{client.client_code} · {client.package_name || 'No package'}</p>
      </div>

      {/* Subscription banner */}
      <div className="surface-card p-5 mb-4 glow-accent-radial">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Subscription</p>
              <p className="text-[14px] font-medium">{subscription ? subscription.package_name : 'No active subscription'}</p>
            </div>
          </div>
          {subscription && (
            <Badge className={cn(getSubscriptionStatusColor(subscription.status), 'capitalize')}>
              {days != null ? `${days} days left` : subscription.status}
            </Badge>
          )}
        </div>
        {subscription && (
          <p className="text-[12px] text-muted-foreground mt-3">{formatDate(subscription.start_date)} → {formatDate(subscription.end_date)}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PortalCard icon={Dumbbell} title="Current Workout" to="/portal/workout">
          {workout ? <><p className="text-[14px] font-medium">{workout.name}</p><p className="text-[12px] text-muted-foreground mt-1 capitalize">{workout.split_type?.replace(/_/g, ' ')} · {workout.days?.length || 0} days</p></> : <Empty text="No workout assigned" />}
        </PortalCard>
        <PortalCard icon={Apple} title="Current Nutrition" to="/portal/nutrition">
          {nutrition ? <><p className="text-[14px] font-medium">{nutrition.name}</p><p className="text-[12px] text-muted-foreground mt-1">{nutrition.daily_calories || '—'} kcal · {nutrition.meals?.length || 0} meals</p></> : <Empty text="No nutrition plan assigned" />}
        </PortalCard>
        <PortalCard icon={TrendingUp} title="Latest Progress" to="/portal/progress">
          {latestMetric ? <><p className="text-[14px] font-medium">{formatDate(latestMetric.entry_date)}</p><p className="text-[12px] text-muted-foreground mt-1">{latestMetric.weight ? `${latestMetric.weight} kg` : ''}{latestMetric.body_fat ? ` · ${latestMetric.body_fat}% BF` : ''}</p></> : <Empty text="No metrics yet" />}
        </PortalCard>
        <PortalCard icon={ClipboardList} title="Pending Form" to="/portal/forms">
          {pendingForm ? <><p className="text-[14px] font-medium">{pendingForm.name}</p><p className="text-[12px] text-muted-foreground mt-1">Due {formatDate(pendingForm.due_date)}</p></> : <Empty text="No pending forms" />}
        </PortalCard>
      </div>

      {notifications.length > 0 && (
        <div className="surface-card p-5 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-4 h-4 text-primary" />
            <h3 className="text-[14px] font-display font-semibold">Notifications</h3>
          </div>
          <div className="space-y-2">
            {notifications.slice(0, 3).map((n) => (
              <div key={n.id} className={cn('p-3 rounded-md border', n.is_read ? 'bg-secondary/20 border-border' : 'bg-primary/5 border-primary/15')}>
                <p className="text-[13px] font-medium">{n.title}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{n.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

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

function PortalCard({ icon: Icon, title, to, children }) {
  return (
    <Link to={to} className="surface-card p-5 hover:glow-subtle transition-all block">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="text-[13px] font-display font-semibold">{title}</h3>
      </div>
      {children}
    </Link>
  );
}

function Empty({ text }) {
  return <p className="text-[13px] text-muted-foreground">{text}</p>;
}