import React from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, CheckCircle2, ArrowRight, Clock } from 'lucide-react';
import { Button } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';

export default function TodayFormsCard({ forms = [], onOpenForm }) {
  const pendingForms = forms.filter((f) => f.submission_status === 'pending');
  const nextPending = pendingForms[0] || null;
  const reviewedCount = forms.filter((f) => f.submission_status === 'reviewed').length;
  const underReviewCount = forms.filter((f) => f.submission_status === 'submitted').length;

  return (
    <div className="surface-card p-5 rounded-xl border border-border/80 flex flex-col justify-between h-full glow-subtle transition-all">
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5 text-primary" />
            Check-ins & Forms
          </span>
          {pendingForms.length > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
              <Clock className="w-3 h-3" /> {pendingForms.length} Due
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3" /> Up to Date
            </span>
          )}
        </div>

        {nextPending ? (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-mono text-amber-400 font-medium">
                {nextPending.due_date ? `Due ${formatDate(nextPending.due_date)}` : 'Due soon'}
              </span>
            </div>
            <h3 className="text-base font-semibold text-foreground mt-0.5 line-clamp-1 font-display">
              {nextPending.name}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Your weekly check-in provides your coach with the biofeedback needed to adjust your plan.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mt-1">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-semibold text-foreground">All Check-ins Complete</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              You are completely caught up on your scheduled check-ins and forms.
            </p>
          </div>
        )}

        {/* Status summary tags */}
        <div className="flex items-center gap-2 mt-3 pt-2">
          <span className="text-[10px] text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded border border-border/40">
            {reviewedCount} Reviewed
          </span>
          {underReviewCount > 0 && (
            <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
              {underReviewCount} Under Review
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between">
        {nextPending ? (
          <div className="w-full flex items-center justify-between gap-2">
            <Button
              size="sm"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-sm"
              onClick={() => onOpenForm(nextPending)}
            >
              Complete Form
            </Button>
            <Link
              to="/portal/forms"
              className="text-xs text-muted-foreground hover:text-foreground shrink-0 px-2 py-1 rounded hover:bg-secondary transition-colors"
            >
              All Forms
            </Link>
          </div>
        ) : (
          <Link
            to="/portal/forms"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium transition-colors"
          >
            View form history <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </div>
  );
}
