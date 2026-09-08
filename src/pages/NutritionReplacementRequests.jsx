import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { MealReplacementRequestsService } from '@/services/mealReplacementRequests';
import { PageHeader, LoadingState, EmptyState, Badge, Button } from '@/components/ui';
import { toast } from '@/components/ui/use-toast';
import { timeAgo, formatDate } from '@/lib/ybs-utils';
import {
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Clock,
  Quote,
  SearchX,
  Utensils,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_META = {
  pending: { label: 'Pending', className: 'text-amber-400 bg-amber-500/10 border-amber-500/25' },
  approved: { label: 'Approved', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  rejected: { label: 'Rejected', className: 'text-red-400 bg-red-500/10 border-red-500/25' },
};

function fmtMacro(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '0';
}

function sandwichLabel(status) {
  return STATUS_META[status] || { label: status || '—', className: 'text-muted-foreground bg-secondary/40 border-border/50' };
}

export default function NutritionReplacementRequests() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [busyId, setBusyId] = useState(null);

  const loadRequests = async () => {
    try {
      setLoading(true);
      const rows = await MealReplacementRequestsService.listForStaff();
      setRequests(rows || []);
    } catch (err) {
      console.error('Error loading replacement requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const filtered = filter === 'all' ? requests : requests.filter((r) => r.status === filter);

  const handleReview = async (req, decision) => {
    const action = decision === 'approve' ? 'approve' : 'reject';
    const confirmMsg =
      action === 'approve'
        ? 'Approve this replacement request? The suggested food will be applied to the client\'s plan (or, for "Other" requests, the request will be acknowledged without any plan change).'
        : 'Reject this replacement request? The client\'s plan will NOT be changed.';
    if (!window.confirm(confirmMsg)) return;

    setBusyId(req.id);
    try {
      if (action === 'approve') {
        await MealReplacementRequestsService.approve(req.id);
        toast({ title: 'Request approved', description: 'The replacement was applied to the client\'s nutrition plan.' });
      } else {
        await MealReplacementRequestsService.reject(req.id);
        toast({ title: 'Request rejected', description: 'The client\'s plan was left unchanged.' });
      }
      await loadRequests();
    } catch (err) {
      console.error(`Failed to ${action} request:`, err);
      toast({
        title: action === 'approve' ? 'Approval failed' : 'Rejection failed',
        description: err?.message || 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading replacement requests…" />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Replacement Requests"
        description="Client meal replacement requests awaiting review"
        icon={ArrowLeftRight}
        actions={null}
      />

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'pending', label: `Pending (${requests.filter((r) => r.status === 'pending').length})` },
          { key: 'all', label: `All (${requests.length})` },
          { key: 'approved', label: `Approved (${requests.filter((r) => r.status === 'approved').length})` },
          { key: 'rejected', label: `Rejected (${requests.filter((r) => r.status === 'rejected').length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
              filter === t.key
                ? 'bg-secondary text-foreground border border-border'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={filter === 'pending' ? 'No pending requests' : `No ${filter} requests`}
          description="Requests from clients show up here for you to approve or reject."
          action={null}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => {
            const meta = sandwichLabel(req.status);
            const client = req.clients || {};
            const plan = req.nutrition_plans || {};
            const isPending = req.status === 'pending';
            const macros = req.current_macros || {};

            return (
              <div
                key={req.id}
                className={cn(
                  'surface-card p-5 rounded-2xl border transition-all',
                  isPending ? 'border-primary/25' : 'border-border/80'
                )}
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border/40">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">
                      {client.full_name || 'Client'}
                    </span>
                    {client.client_code && (
                      <span className="text-[11px] font-mono text-muted-foreground">({client.client_code})</span>
                    )}
                    <Badge className={meta.className}>{meta.label}</Badge>
                    <Badge
                      className={cn(
                        'text-[10px]',
                        req.request_type === 'other'
                          ? 'text-purple-400 bg-purple-500/10 border-purple-500/25'
                          : 'text-primary bg-primary/10 border-primary/20'
                      )}
                    >
                      {req.request_type === 'other' ? 'Other' : 'Replacement'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span title={formatDate(req.created_at)}>{timeAgo(req.created_at)}</span>
                  </div>
                </div>

                {/* Body: current meal + requested replacement + reason */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      <Utensils className="w-3.5 h-3.5 text-primary" /> Current Meal
                    </div>
                    <p className="font-semibold text-foreground text-[13px]">{req.meal_name}</p>
                    <p className="text-foreground/90">{req.current_food_name}</p>
                    <p className="text-muted-foreground font-mono text-[11px]">
                      {fmtMacro(macros.amount)} {macros.unit || 'g'} · {Math.round(Number(macros.calories) || 0)} kcal
                      {req.current_food_id && plan?.name ? ` · Plan: ${plan.name}` : ''}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      <ArrowLeftRight className="w-3.5 h-3.5 text-primary" /> Requested Replacement
                    </div>
                    {req.request_type === 'other' ? (
                      <p className="text-foreground/90">
                        Client didn't like the suggested alternatives and wants more options suggested in chat.
                      </p>
                    ) : (
                      <>
                        <p className="font-semibold text-foreground text-[13px]">{req.requested_food_name || '—'}</p>
                        {req.requested_replacement && (
                          <p className="text-muted-foreground font-mono text-[11px]">
                            {fmtMacro(req.requested_replacement.recommended_amount)}{' '}
                            {req.requested_replacement.recommended_unit || 'g'} ·{' '}
                            {Math.round(Number(req.requested_replacement.estimated_calories) || 0)} kcal ·{' '}
                            {fmtMacro(req.requested_replacement.estimated_protein)}P /{' '}
                            {fmtMacro(req.requested_replacement.estimated_carbs)}C /{' '}
                            {fmtMacro(req.requested_replacement.estimated_fat)}F
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Client reason */}
                {req.reason && (
                  <div className="flex items-start gap-2 text-[12px] text-muted-foreground leading-relaxed bg-secondary/30 border border-border/40 p-3 rounded-xl">
                    <Quote className="w-3.5 h-3.5 shrink-0 text-primary mt-0.5" />
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-foreground/70 font-semibold block mb-0.5">
                        Why would you like to replace this meal?
                      </span>
                      {req.reason}
                    </div>
                  </div>
                )}

                {/* Footer: reviewer meta + actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-border/40">
                  <div className="text-[11px] text-muted-foreground">
                    {req.status === 'pending'
                      ? `Requested by ${req.requester_name || 'Client'}`
                      : (
                          <span>
                            Reviewed by {req.reviewer_name || 'Staff'}
                            {req.reviewed_at ? ` · ${timeAgo(req.reviewed_at)}` : ''}
                          </span>
                        )}
                  </div>

                  {isPending && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId === req.id}
                        onClick={() => handleReview(req, 'reject')}
                      >
                        <X className="w-3.5 h-3.5" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyId === req.id}
                        onClick={() => handleReview(req, 'approve')}
                      >
                        {busyId === req.id ? (
                          'Working…'
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approve & Apply
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  {req.status === 'approved' && (
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Check className="w-3.5 h-3.5 text-emerald-400" /> Replacement applied
                    </span>
                  )}
                  {req.status === 'rejected' && (
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <X className="w-3.5 h-3.5 text-red-400" /> No changes made to the plan
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}