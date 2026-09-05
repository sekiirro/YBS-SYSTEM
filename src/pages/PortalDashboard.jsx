import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { ClientsService } from '@/services/clients';
import { NotificationsService } from '@/services/notifications';
import { LoadingState } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import { Bell, User } from 'lucide-react';
import { cn } from '@/lib/utils';

import ClientDashboard from './portal/ClientDashboard';
import ClientForms from './portal/ClientForms';
import ClientMetrics from './portal/ClientMetrics';
import ClientNutrition from './portal/ClientNutrition';
import ClientExercise from './portal/ClientExercise';
import ClientPackage from './portal/ClientPackage';

export default function PortalDashboard({ view = 'dashboard' }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user?.self_client_id) {
        if (mounted) setLoading(false);
        return;
      }
      try {
        const [c, notifs] = await Promise.all([
          ClientsService.getById(user.self_client_id),
          view === 'notifications' ? NotificationsService.list(user.id).catch(() => []) : Promise.resolve([]),
        ]);
        if (mounted) {
          setClient(c);
          setNotifications(notifs || []);
        }
      } catch (err) {
        console.error('Portal load error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [user, view]);

  // Route to modular portal pages
  if (view === 'exercise' || view === 'workout') {
    return <ClientExercise />;
  }

  if (view === 'nutrition') {
    return <ClientNutrition />;
  }

  if (view === 'metrics' || view === 'progress') {
    return <ClientMetrics />;
  }

  if (view === 'forms' || view === 'assessments') {
    return <ClientForms />;
  }

  if (view === 'package' || view === 'subscription') {
    return <ClientPackage />;
  }

  if (view === 'notifications') {
    if (loading) return <LoadingState label="Loading notifications…" />;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 pb-4 border-b border-border/60">
          <Bell className="w-5 h-5 text-primary" />
          <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
            Notifications
          </h1>
        </div>
        {notifications.length > 0 ? (
          <div className="space-y-2.5 max-w-2xl">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={cn(
                  'p-4 rounded-xl border surface-card transition-all',
                  n.is_read ? 'opacity-80 border-border/60' : 'border-primary/30 bg-primary/5'
                )}
              >
                <h4 className="text-sm font-semibold text-foreground font-display">{n.title}</h4>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{n.message}</p>
                <p className="text-[10px] text-muted-foreground/60 font-mono mt-2">{formatDate(n.created_at || n.created_date)}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface-card p-12 text-center rounded-xl border border-border text-muted-foreground text-xs">
            No notifications at this time.
          </div>
        )}
      </div>
    );
  }

  if (view === 'profile') {
    if (loading) return <LoadingState label="Loading profile…" />;
    if (!client) {
      return (
        <div className="surface-card p-12 text-center text-muted-foreground text-xs rounded-xl border border-border">
          Client profile not linked.
        </div>
      );
    }

    return (
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-2 pb-4 border-b border-border/60">
          <User className="w-5 h-5 text-primary" />
          <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
            My Profile
          </h1>
        </div>
        <div className="surface-card p-6 rounded-2xl border border-border/80 space-y-6">
          <div className="flex items-center gap-4 pb-5 border-b border-border/60">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-xl font-display">
              {client.full_name?.[0]?.toUpperCase() || 'C'}
            </div>
            <div>
              <p className="text-lg font-bold text-foreground font-display">{client.full_name}</p>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{client.client_code}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-secondary/30 border border-border/40">
              <span className="text-muted-foreground text-[10px] uppercase font-semibold block">Phone</span>
              <p className="font-mono text-foreground font-medium mt-1">{client.phone || '—'}</p>
            </div>
            <div className="p-3 rounded-lg bg-secondary/30 border border-border/40">
              <span className="text-muted-foreground text-[10px] uppercase font-semibold block">Email</span>
              <p className="font-mono text-foreground font-medium mt-1">{client.email || '—'}</p>
            </div>
            <div className="p-3 rounded-lg bg-secondary/30 border border-border/40">
              <span className="text-muted-foreground text-[10px] uppercase font-semibold block">Assigned Coach</span>
              <p className="font-medium text-foreground mt-1">{client.assigned_ybs_coach_name || 'YBS Coaching Team'}</p>
            </div>
            <div className="p-3 rounded-lg bg-secondary/30 border border-border/40">
              <span className="text-muted-foreground text-[10px] uppercase font-semibold block">Follow-up Day</span>
              <p className="font-medium text-foreground mt-1 capitalize">{client.follow_up_day || 'Saturday'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default: Dashboard View
  return <ClientDashboard />;
}