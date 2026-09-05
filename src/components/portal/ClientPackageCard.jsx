import React from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Calendar, ArrowRight, ShieldCheck } from 'lucide-react';
import { formatDate, daysUntil, getSubscriptionStatusColor } from '@/lib/ybs-utils';
import { cn } from '@/lib/utils';

export default function ClientPackageCard({ subscription, client }) {
  if (!subscription) {
    return (
      <div className="surface-card p-5 lg:p-6 rounded-xl border border-border/80">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5 text-primary" />
            Your Package
          </span>
        </div>
        <h3 className="text-base font-semibold text-foreground">No Active Package</h3>
        <p className="text-xs text-muted-foreground mt-1">
          You currently have no active coaching package assigned. Contact your coach or administrator.
        </p>
      </div>
    );
  }

  const days = daysUntil(subscription.end_date);
  const isExpiringSoon = days != null && days <= 7 && days > 0;
  const isExpired = days != null && days <= 0;

  return (
    <div className="surface-card p-5 lg:p-6 rounded-xl border border-border/80 glow-subtle">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-semibold text-primary tracking-wider block">
              Current Package
            </span>
            <h3 className="text-lg font-bold text-foreground font-display">
              {subscription.package_name || client?.package_name || 'Coaching Package'}
            </h3>
          </div>
        </div>

        <span
          className={cn(
            'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border',
            getSubscriptionStatusColor(subscription.status)
          )}
        >
          ● {subscription.status}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 py-3 border-y border-border/40 text-xs">
        <div>
          <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Period</span>
          <span className="font-medium text-foreground mt-0.5 block">
            {formatDate(subscription.start_date)} → {formatDate(subscription.end_date)}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Remaining</span>
          <span
            className={cn(
              'font-semibold mt-0.5 block',
              isExpired ? 'text-red-400' : isExpiringSoon ? 'text-amber-400' : 'text-primary'
            )}
          >
            {days != null ? (days > 0 ? `${days} days remaining` : 'Expired') : 'Ongoing'}
          </span>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Coach</span>
          <span className="font-medium text-foreground mt-0.5 block">
            {client?.assigned_ybs_coach_name || 'YBS Coaching Team'}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="w-3.5 h-3.5" />
          <span>Follow-up Day: <strong className="capitalize text-foreground font-semibold">{client?.follow_up_day || 'Saturday'}</strong></span>
        </div>
        <Link
          to="/portal/package"
          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1 transition-colors"
        >
          Package details <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
