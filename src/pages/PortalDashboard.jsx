const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { LoadingState, Badge } from '@/components/ui';
import { formatDate, getSubscriptionStatusColor, daysUntil } from '@/lib/ybs-utils';
import { Dumbbell, Apple, TrendingUp, ClipboardList, CreditCard, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PortalDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [workout, setWorkout] = useState(null);
  const [nutrition, setNutrition] = useState(null);
  const [latestMetric, setLatestMetric] = useState(null);
  const [pendingForm, setPendingForm] = useState(null);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    (async () => {
      if (!user?.self_client_id) { setLoading(false); return; }
      try {
        const c = await db.entities.Client.get(user.self_client_id);
        setClient(c);
        const [subs, wps, nps, metrics, forms, notifs] = await Promise.all([
          db.entities.Subscription.filter({ client_id: user.self_client_id, status: 'active' }, '-created_date', 1),
          db.entities.WorkoutPlan.filter({ client_id: user.self_client_id, is_archived: false }, '-created_date', 1),
          db.entities.NutritionPlan.filter({ client_id: user.self_client_id, is_archived: false }, '-created_date', 1),
          db.entities.MetricEntry.filter({ client_id: user.self_client_id }, '-entry_date', 1),
          db.entities.Assessment.filter({ assigned_client_id: user.self_client_id, submission_status: 'pending' }, '-created_date', 1),
          db.entities.Notification.filter({ user_id: user.id }, '-created_date', 5),
        ]);
        setSubscription(subs[0] || null);
        setWorkout(wps[0] || null);
        setNutrition(nps[0] || null);
        setLatestMetric(metrics[0] || null);
        setPendingForm(forms[0] || null);
        setNotifications(notifs);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [user]);

  if (loading) return <LoadingState label="Loading your portal…" />;
  if (!client) return <div className="text-center py-16 text-muted-foreground text-[13px]">Your client profile is not linked yet.</div>;

  const days = subscription ? daysUntil(subscription.end_date) : null;

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
        <PortalCard icon={ClipboardList} title="Pending Assessment" to="/portal/assessments">
          {pendingForm ? <><p className="text-[14px] font-medium">{pendingForm.name}</p><p className="text-[12px] text-muted-foreground mt-1">Due {formatDate(pendingForm.due_date)}</p></> : <Empty text="No pending assessments" />}
        </PortalCard>
      </div>

      {notifications.length > 0 && (
        <div className="surface-card p-5 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-4 h-4 text-primary" />
            <h3 className="text-[14px] font-display font-semibold">Notifications</h3>
          </div>
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className={cn('p-3 rounded-md border', n.is_read ? 'bg-secondary/20 border-border' : 'bg-primary/5 border-primary/15')}>
                <p className="text-[13px] font-medium">{n.title}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{n.message}</p>
              </div>
            ))}
          </div>
        </div>
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