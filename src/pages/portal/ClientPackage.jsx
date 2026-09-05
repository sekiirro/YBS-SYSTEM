import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { SubscriptionsService } from '@/services/subscriptions';
import { ClientsService } from '@/services/clients';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import { LoadingState, Badge } from '@/components/ui';
import { formatDate, daysUntil, getSubscriptionStatusColor } from '@/lib/ybs-utils';
import { CreditCard, ShieldCheck, Check, Calendar, History } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ClientPackage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);

  const loadData = useCallback(async () => {
    if (!user?.self_client_id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [c, subs] = await Promise.all([
        ClientsService.getById(user.self_client_id),
        SubscriptionsService.list({ client_id: user.self_client_id }),
      ]);
      setClient(c);
      setSubscriptions(subs || []);
    } catch (err) {
      console.error('Error loading package information:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.self_client_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) return <LoadingState label="Loading your package information…" />;

  const activeSub = subscriptions.find((s) => s.status === 'active') || subscriptions[0] || null;
  const historySubs = subscriptions.filter((s) => s.id !== activeSub?.id);

  const days = activeSub ? daysUntil(activeSub.end_date) : null;
  const isExpiringSoon = days != null && days <= 7 && days > 0;
  const isExpired = days != null && days <= 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="pb-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
            My Package & Subscription
          </h1>
        </div>
        <p className="text-[13px] text-muted-foreground mt-1">
          Review your coaching tier, active coverage duration, and historical enrollment records.
        </p>
      </div>

      {/* Active Package Hero Card */}
      {!activeSub ? (
        <ClientEmptyState
          icon={CreditCard}
          title="No Active Package Assigned"
          description="You do not have an active package assigned at this time. Contact your coach to activate your subscription."
        />
      ) : (
        <div className="surface-card p-6 lg:p-8 rounded-2xl border border-border/80 glow-primary space-y-6 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary glow-primary">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary block">
                  Current Active Package
                </span>
                <h2 className="text-2xl font-bold font-display text-foreground mt-0.5">
                  {activeSub.package_name || client?.package_name || 'Coaching Package'}
                </h2>
              </div>
            </div>

            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold capitalize self-start sm:self-auto border',
                getSubscriptionStatusColor(activeSub.status)
              )}
            >
              ● {activeSub.status}
            </span>
          </div>

          {/* Key metrics grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-4 border-y border-border/50 text-xs">
            <div className="p-3 rounded-xl bg-secondary/30 border border-border/40">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Duration Window</span>
              <span className="text-sm font-semibold text-foreground mt-1 block">
                {formatDate(activeSub.start_date)} → {formatDate(activeSub.end_date)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/40">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Days Remaining</span>
              <span
                className={cn(
                  'text-base font-bold font-mono mt-1 block',
                  isExpired ? 'text-red-400' : isExpiringSoon ? 'text-amber-400' : 'text-primary'
                )}
              >
                {days != null ? (days > 0 ? `${days} days left` : 'Subscription Expired') : 'Active'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/40">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Assigned Coach</span>
              <span className="text-sm font-semibold text-foreground mt-1 block">
                {client?.assigned_ybs_coach_name || 'YBS Coaching Team'}
              </span>
            </div>
          </div>

          {/* Coaching inclusions */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What&apos;s Included In Your Program
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-foreground">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary shrink-0" />
                <span>Customized macro & meal nutrition programming</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary shrink-0" />
                <span>Tailored split training & progressive overload tracker</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary shrink-0" />
                <span>Weekly check-in evaluation & coach calibrations</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary shrink-0" />
                <span>Circumference & body composition metric logging</span>
              </div>
            </div>
          </div>

          <div className="pt-2 text-xs text-muted-foreground flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary/80" />
            <span>Designated Follow-up Day: <strong className="text-foreground capitalize">{client?.follow_up_day || 'Saturday'}</strong></span>
          </div>
        </div>
      )}

      {/* Historical Subscriptions */}
      {historySubs.length > 0 && (
        <div className="space-y-4 pt-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground font-display">
              Subscription History
            </h2>
          </div>

          <div className="space-y-2.5">
            {historySubs.map((s) => (
              <div
                key={s.id}
                className="surface-card p-4 rounded-xl border border-border/70 flex items-center justify-between gap-4"
              >
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{s.package_name || 'Coaching Subscription'}</h4>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {formatDate(s.start_date)} → {formatDate(s.end_date)}
                  </p>
                </div>
                <Badge className={cn('capitalize text-[11px]', getSubscriptionStatusColor(s.status))}>
                  {s.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
