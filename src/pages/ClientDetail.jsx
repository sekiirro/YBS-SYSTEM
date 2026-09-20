import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { ClientsService } from '@/services/clients';
import { SubscriptionsService } from '@/services/subscriptions';
import { AssessmentsService } from '@/services/assessments';
import { MetricsService } from '@/services/metrics';
import ClientNutritionWorkspace from '@/components/client/ClientNutritionWorkspace';
import ClientProgressPanel from '@/components/clients/ClientProgressPanel';
import ClientTrainingWorkspace from '@/components/client/ClientTrainingWorkspace';
import { hasPermission, canViewFinancials } from '@/lib/permissions';
import { isPlatformAdmin, isWorkspaceOwner } from '@/lib/ybs-auth';
import { LoadingState, Badge, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import { formatDate, formatCurrency, getSubscriptionStatusColor, getFormStatusColor, getFormStatusLabel, getInitials } from '@/lib/ybs-utils';
import {
  ArrowLeft, Phone, Mail, Calendar, User,
  ClipboardList, TrendingUp, Apple, Dumbbell, Activity, Edit, Plus, Check, Trash2, Archive, Eye, PauseCircle, CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

const TABS = [
  { id: 'overview',      label: 'Overview',      icon: User          },
  { id: 'nutrition',     label: 'Nutrition',      icon: Apple         },
  { id: 'workout',       label: 'Workout',        icon: Dumbbell      },
  { id: 'subscription',  label: 'Subscription',   icon: CreditCard    },
  { id: 'forms',         label: 'Forms',          icon: ClipboardList },
  { id: 'metrics',       label: 'Metrics',        icon: TrendingUp    },
  { id: 'timeline',      label: 'Timeline',       icon: Activity      },
];

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [showEdit, setShowEdit] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [forms, setForms] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [dangerAction, setDangerAction] = useState(null); // 'remove' | 'delete' | null

  useEffect(() => {
    loadClient();
  }, [id]);

  const loadClient = async () => {
    try {
      setLoading(true);
      const c = await ClientsService.getById(id);
      setClient(c);

      const [subs, frm, mtr, summaryData] = await Promise.all([
        SubscriptionsService.list({ client_id: id }).catch(() => []),
        AssessmentsService.list({ client_id: id }).catch(() => []),
        MetricsService.listByClient(id).catch(() => []),
        SubscriptionsService.getSummary(id).catch(() => null),
      ]);
      setTimeline([]);
      setSubscriptions(subs);
      setForms(frm);
      setMetrics(mtr);
      setSummary(summaryData);
    } catch (err) {
      console.error('Error loading client:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingState label="Loading client…" />;
  if (!client) return <div className="text-center py-16 text-muted-foreground">Client not found</div>;

  const canEdit = hasPermission(user, 'clients.update') && (user.role !== 'trainer');
  const isAdmin = isPlatformAdmin(user);
  const canManageClient = (c) =>
    isAdmin ||
    (isWorkspaceOwner(user) && (user.managed_workspace_ids || []).includes(c.workspace_id));

  const handleDanger = async () => {
    try {
      if (dangerAction === 'remove') {
        await ClientsService.removeFromWorkspace(id);
      } else if (dangerAction === 'delete') {
        await ClientsService.deletePermanently(id);
      }
      setDangerAction(null);
      navigate('/clients');
    } catch (err) {
      console.error('Client management action failed:', err);
      window.alert(err.message || 'Action failed.');
      setDangerAction(null);
    }
  };

  return (
    <div>
      {/* Back nav */}
      <button onClick={() => navigate('/clients')} className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Clients
      </button>

      {/* Header card */}
      <div className="surface-card p-5 mb-4 bg-gradient-to-br from-[#0d1322] to-[#0b0f19] border border-white/[0.08]">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/25 shadow-[0_0_20px_rgba(59,130,246,0.15)] flex items-center justify-center text-primary text-lg font-semibold shrink-0">
              {getInitials(client.full_name)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-display font-semibold tracking-tight">{client.full_name}</h1>
                {(client.status === 'active' && client.subscription_status === 'active') ? (
                  <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">Active</Badge>
                ) : (
                  <Badge className="text-amber-400 bg-amber-500/10 border-amber-500/20">Awaiting Activation</Badge>
                )}
                {client.activation_source === 'manual_override' && (
                  <Badge className="text-violet-300 bg-violet-500/10 border-violet-500/25">Manual Override</Badge>
                )}
              </div>
              <p className="text-[12px] text-muted-foreground font-mono mt-1">{client.client_code}</p>
              <div className="flex items-center gap-4 mt-2 flex-wrap text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {client.phone || '—'}</span>
                {client.email && <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {client.email}</span>}
                <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Joined {formatDate(client.join_date)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button variant="secondary" onClick={() => setShowEdit(true)}>
                <Edit className="w-4 h-4" /> Edit
              </Button>
            )}
            {client.status !== 'active' && canEdit && (
              <ActivateClientButton clientId={id} canOverride={canManageClient(client)} onUpdated={loadClient} />
            )}
            {canManageClient(client) && (
              <>
                <Button variant="ghost" size="sm" className="text-destructive/90 hover:text-destructive" onClick={() => setDangerAction('remove')}>
                  <Archive className="w-4 h-4" /> Remove
                </Button>
                {isPlatformAdmin(user) && (
                  <Button variant="ghost" size="sm" className="text-destructive/90 hover:text-destructive" onClick={() => setDangerAction('delete')}>
                    <Trash2 className="w-4 h-4" /> Delete
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1 border-b border-white/[0.06]">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative flex items-center gap-2 px-3.5 py-2.5 rounded-t-lg text-[13px] font-medium whitespace-nowrap transition-all duration-200',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="activeClientTab"
                  className="absolute inset-0 rounded-t-lg bg-primary/10 border-b-2 border-primary"
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Icon className="w-4 h-4" /> {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className={cn("surface-card", activeTab === 'workout' ? "p-0 overflow-hidden" : "p-5")}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {activeTab === 'overview' && <OverviewTab client={client} summary={summary} />}
            {activeTab === 'subscription' && <SubscriptionTab client={client} summary={summary} subscriptions={subscriptions} user={user} onUpdated={loadClient} />}
            {activeTab === 'forms' && <FormsTab forms={forms} />}
            {activeTab === 'metrics' && <ClientProgressPanel metrics={metrics} clientId={id} client={client} onUpdated={loadClient} />}
            {activeTab === 'nutrition' && <ClientNutritionWorkspace client={client} />}
            {activeTab === 'workout' && <ClientTrainingWorkspace client={client} />}
            {activeTab === 'timeline' && <TimelineTab timeline={timeline} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {showEdit && <EditClientModal client={client} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); loadClient(); }} />}
      {dangerAction && (
        <Modal open onClose={() => setDangerAction(null)} title={dangerAction === 'remove' ? 'Remove Client from Workspace' : 'Delete Client Permanently'} size="md">
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              {dangerAction === 'remove'
                ? <>This will archive <strong className="text-foreground">{client.full_name}</strong>, cancel open subscriptions, and end coach allocations. The record can be restored later.</>
                : <>This will permanently delete <strong className="text-foreground">{client.full_name}</strong> and all associated records (subscriptions, metrics, assessments, plans, timeline). This cannot be undone.</>}
            </p>
            <p className="text-[12px] text-red-400 bg-destructive/10 border border-destructive/20 rounded-md p-3">
              {dangerAction === 'remove'
                ? 'This action is audited and reversible via a workspace restore.'
                : 'Platform Owner only. Permanent and irreversible.'}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setDangerAction(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDanger}>
                {dangerAction === 'remove' ? 'Remove Client' : 'Delete Permanently'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OverviewTab({ client, summary }) {
  const sub = summary?.subscription;
  const isPreActivation = summary?.pre_activation;
  const daysRemaining = summary?.subscription?.remaining_days;
  const canViewFinancials = summary?.can_view_financials;

  const computeDurationLabel = () => {
    if (!sub?.start_date || !sub?.end_date) return '—';
    if (isPreActivation) return 'Pending activation';
    const start = formatDate(sub.start_date);
    const end = formatDate(sub.end_date);
    return `${start} → ${end}`;
  };

  const computeDaysRemainingLabel = () => {
    if (isPreActivation || daysRemaining === null || daysRemaining === undefined) {
      return 'Pre-activation — counting begins after Nutrition + Workout plans are activated';
    }
    return `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`;
  };

  const info = [
    { label: 'Date of Birth', value: formatDate(client.date_of_birth) },
    { label: 'Gender', value: client.gender ? client.gender.charAt(0).toUpperCase() + client.gender.slice(1) : '—' },
    { label: 'Height', value: client.height ? `${client.height} cm` : '—' },
    { label: 'Current Weight', value: client.current_weight ? `${client.current_weight} kg` : '—' },
    { label: 'Body Fat %', value: client.body_fat ? `${client.body_fat}%` : '—' },
    { label: 'Assigned Trainer', value: client.assigned_trainer_name || '—' },
    { label: 'Package', value: summary?.package?.name || client.package_name || '—' },
    { label: 'Follow-up Day', value: client.follow_up_day ? client.follow_up_day.charAt(0).toUpperCase() + client.follow_up_day.slice(1) : '—' },
    { label: 'Telegram', value: client.telegram_connected ? 'Connected' : 'Not Connected' },
  ];

  return (
    <div>
      <h3 className="text-[14px] font-display font-semibold mb-4">Client Information</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
        {info.map((item) => (
          <div key={item.label} className="flex flex-col">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{item.label}</span>
            <span className="text-[13px] font-medium mt-1">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-border">
        <h4 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-3">Subscription</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <div className="flex flex-col">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Duration</span>
            <span className="text-[13px] font-medium mt-1">{computeDurationLabel()}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Days Remaining</span>
            <span className="text-[13px] font-medium mt-1">{computeDaysRemainingLabel()}</span>
          </div>
          {canViewFinancials && sub?.start_date && (
            <>
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Price</span>
                <span className="text-[13px] font-medium mt-1">
                  {formatCurrency(summary?.financials?.price, summary?.financials?.currency)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Payment</span>
                <span className="text-[13px] font-medium mt-1 capitalize">{summary?.financials?.payment_status || '—'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {client.notes && (
        <div className="mt-6 pt-4 border-t border-border">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Notes</span>
          <p className="text-[13px] mt-1.5 text-muted-foreground">{client.notes}</p>
        </div>
      )}
    </div>
  );
}

function SubscriptionTab({ summary, subscriptions, user, onUpdated }) {
  const isAdmin = isPlatformAdmin(user);
  const canManageLifecycle = isAdmin;
  const [lifecycleModal, setLifecycleModal] = useState(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');

  const sub = summary?.subscription;
  const freeze = summary?.freeze;
  const isPreActivation = summary?.pre_activation;

  const handleLifecycleAction = async (action, payload) => {
    setLifecycleLoading(true);
    setLifecycleError('');
    try {
      if (action === 'freeze') {
        await SubscriptionsService.freeze(sub.id, payload.freezeDays);
      } else if (action === 'renew') {
        await SubscriptionsService.renew(sub.id, payload.packageId, payload.extendDays);
      } else if (action === 'override') {
        await SubscriptionsService.overrideDates(sub.id, payload.startDate, payload.endDate);
      }
      await onUpdated();
      setLifecycleModal(null);
    } catch (err) {
      setLifecycleError(err.message || 'Action failed');
    } finally {
      setLifecycleLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-[14px] font-display font-semibold">Subscription History</h3>
          {sub && !isPreActivation && (
            <div className="flex items-center gap-4 mt-2 text-[12px] text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{formatDate(sub.start_date)}</span> →{' '}
                <span className="font-medium text-foreground">{formatDate(sub.end_date)}</span>
              </span>
              {freeze?.is_frozen && (
                <Badge className="text-sky-400 bg-sky-500/10 border-sky-500/20">
                  Frozen — {freeze.active?.freeze_days} day{freeze.active?.freeze_days === 1 ? '' : 's'}
                </Badge>
              )}
              {sub.manually_adjusted && (
                <Badge className="text-amber-400 bg-amber-500/10 border-amber-500/20">Manually adjusted</Badge>
              )}
            </div>
          )}
          {isPreActivation && (
            <p className="text-[12px] text-muted-foreground mt-2">
              Subscription counting begins after Nutrition + Workout plans are activated.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canManageLifecycle && sub && !isPreActivation && (
            <>
              {freeze?.is_frozen ? (
                <Button size="sm" variant="outline" disabled>
                  <PauseCircle className="w-4 h-4 mr-1" /> Frozen
                </Button>
              ) : (
                <Button size="sm" onClick={() => setLifecycleModal({ type: 'freeze' })}>
                  <PauseCircle className="w-4 h-4 mr-1" /> Freeze
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setLifecycleModal({ type: 'override' })}>
                <Edit className="w-4 h-4 mr-1" /> Edit Dates
              </Button>
              <Button size="sm" onClick={() => setLifecycleModal({ type: 'renew' })}>
                <Plus className="w-4 h-4 mr-1" /> Renew
              </Button>
            </>
          )}
        </div>
      </div>

      {subscriptions.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No subscription history</p>
      ) : (
        <div className="space-y-3">
          {subscriptions.map((s) => (
            <div key={s.id} className="p-4 rounded-lg bg-secondary/30 border border-border">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium">{s.package_name || 'Package'}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(s.start_date)} → {formatDate(s.end_date)}</p>
                </div>
                <Badge className={cn(getSubscriptionStatusColor(s.status), 'capitalize')}>{s.status.replace('_', ' ')}</Badge>
              </div>
              {s.price != null && canViewFinancials(user) && (
                <p className="text-[12px] text-muted-foreground mt-2">Price: {formatCurrency(s.price)} · Payment: <span className="capitalize">{s.payment_status}</span></p>
              )}
            </div>
          ))}
        </div>
      )}

      {lifecycleModal && (
        <Modal
          open={true}
          onClose={() => !lifecycleLoading && setLifecycleModal(null)}
          title={
            lifecycleModal.type === 'freeze' ? 'Freeze Subscription' :
            lifecycleModal.type === 'renew' ? 'Renew Subscription' :
            'Override Subscription Dates'
          }
          size="md"
        >
          <LifecycleModal
            type={lifecycleModal.type}
            sub={sub}
            summary={summary}
            loading={lifecycleLoading}
            error={lifecycleError}
            onCancel={() => setLifecycleModal(null)}
            onSubmit={handleLifecycleAction}
          />
        </Modal>
      )}
    </div>
  );
}

function LifecycleModal({ type, sub, summary, loading, error, onCancel, onSubmit }) {
  const [freezeDays, setFreezeDays] = useState(7);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedPackage, setSelectedPackage] = useState('');
  const [packages, setPackages] = useState([]);
  const [packagesLoading, setPackagesLoading] = useState(false);

  useEffect(() => {
    if (type === 'renew' && summary?.subscription) {
      setPackagesLoading(true);
      SubscriptionsService.listWorkspacePackages(summary.workspace_id)
        .then((pkgs) => {
          setPackages(pkgs || []);
          if (pkgs.length > 0) setSelectedPackage(pkgs[0].id);
        })
        .catch(() => {})
        .finally(() => setPackagesLoading(false));
    }
  }, [type, summary]);

  const handleSubmit = () => {
    if (type === 'freeze') {
      if (!freezeDays || freezeDays < 1 || freezeDays > 365) return;
      onSubmit('freeze', { freezeDays: Number(freezeDays) });
    } else if (type === 'renew') {
      onSubmit('renew', { packageId: selectedPackage || null, extendDays: null });
    } else if (type === 'override') {
      const payload = {
        startDate: startDate || null,
        endDate: endDate || null,
      };
      if (!payload.startDate && !payload.endDate) return;
      onSubmit('override', payload);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">{error}</div>
      )}

      {type === 'freeze' && (
        <>
          <p className="text-[13px] text-muted-foreground">
            Freezing pauses the subscription countdown for the specified number of days.
            The end date is extended by the freeze duration. Days Remaining stays constant during the freeze.
          </p>
          <div className="space-y-2">
            <label className="text-[12px] font-medium">Freeze Duration (days)</label>
            <input
              type="number"
              min="1"
              max="365"
              value={freezeDays}
              onChange={(e) => setFreezeDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 7)))}
              className="w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Current Days Remaining: <strong>{summary?.subscription?.remaining_days ?? '—'}</strong>
            {sub?.end_date && <> · Current End Date: <strong>{formatDate(sub.end_date)}</strong></>}
          </p>
        </>
      )}

      {type === 'renew' && (
        <>
          <p className="text-[13px] text-muted-foreground">
            Create a new subscription cycle. The current cycle is marked as renewed (historical); the new cycle becomes active.
          </p>
          {packagesLoading ? (
            <p className="text-[13px] text-muted-foreground">Loading packages…</p>
          ) : (
            <div className="space-y-2">
              <label className="text-[12px] font-medium">Select Package</label>
              <select
                value={selectedPackage}
                onChange={(e) => setSelectedPackage(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
              >
                <option value="">Same package ({sub?.package_name_snapshot || '—'})</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatCurrency(p.price, p.currency)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {type === 'override' && (
        <>
          <p className="text-[13px] text-muted-foreground">
            Override the subscription start/end dates. Leave a field blank to preserve the existing value
            (start only → end recomputed from package duration).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium">Start Date</label>
              <input
                type="date"
                value={startDate || (sub?.start_date || '').split('T')[0]}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium">End Date</label>
              <input
                type="date"
                value={endDate || (sub?.end_date || '').split('T')[0]}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
              />
            </div>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? 'Processing…' : type === 'freeze' ? 'Freeze' : type === 'renew' ? 'Renew' : 'Save Dates'}
        </Button>
      </div>
    </div>
  );
}

function FormsTab({ forms }) {
  const [viewingForm, setViewingForm] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  const openViewer = async (f) => {
    if (f.submission_status !== 'submitted' && f.submission_status !== 'reviewed') return;
    setViewLoading(true);
    try {
      const full = await AssessmentsService.getById(f.id);
      setViewingForm(full);
    } catch (err) {
      console.error('Failed to load form responses:', err);
    } finally {
      setViewLoading(false);
    }
  };

  return (
    <div>
      <h3 className="text-[14px] font-display font-semibold mb-4">Assigned Forms</h3>
      {forms.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No forms assigned</p>
      ) : (
        <div className="space-y-2">
          {forms.map((f) => {
            const isSubmitted = f.submission_status === 'submitted' || f.submission_status === 'reviewed';
            return (
              <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <p className="text-[13px] font-medium">{f.name}</p>
                  <p className="text-[11px] text-muted-foreground">Due {formatDate(f.due_date)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isSubmitted && (
                    <Button size="sm" variant="secondary" onClick={() => openViewer(f)} disabled={viewLoading}>
                      <Eye className="w-3.5 h-3.5 mr-1" /> View Form
                    </Button>
                  )}
                  <Badge className={cn(getFormStatusColor(f.submission_status), 'capitalize')}>{getFormStatusLabel(f.submission_status)}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {viewingForm && <ViewResponsesModal form={viewingForm} onClose={() => setViewingForm(null)} />}
    </div>
  );
}

function ViewResponsesModal({ form, onClose }) {
  const sortedQuestions = [...(form.questions_snapshot || [])].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <Modal open onClose={onClose} title="Form Responses" size="lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
          <div>
            <p className="text-[13px] font-medium">{form.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Submitted {formatDate(form.submitted_at)}</p>
          </div>
          <Badge className={cn(getFormStatusColor(form.submission_status), 'capitalize')}>
            {getFormStatusLabel(form.submission_status)}
          </Badge>
        </div>

        {sortedQuestions.map((q, idx) => {
          const resp = (form.assessment_responses || []).find((r) => r.question_id === q.id);
          const val = resp?.response_value;
          const displayVal = val == null ? '—' : (Array.isArray(val) ? val.join(', ') : String(val));
          const currentSection = q.conditional_rules?.section;
          const prevSection = idx > 0 ? sortedQuestions[idx - 1]?.conditional_rules?.section : null;
          const isNewSection = currentSection && currentSection !== prevSection;

          return (
            <React.Fragment key={q.id}>
              {isNewSection && (
                <div className={cn('pt-4 pb-1 border-b border-border/50 mb-2', idx > 0 && 'mt-4')}>
                  <p className="text-[12px] font-semibold text-primary uppercase tracking-wider" dir="auto">
                    {currentSection}
                  </p>
                </div>
              )}
              <div className="space-y-1 py-1">
                <p className="text-[12px] font-medium text-muted-foreground" dir="auto">Q{idx + 1}. {q.label}</p>
                <p className="text-[13px] text-foreground pl-4" dir="auto">
                  {(q.question_type === 'file_upload' || q.question_type === 'image_upload')
                    ? (displayVal && displayVal !== '—' && displayVal !== '""' ? displayVal : 'يتم الإرسال على رقم المتابعة')
                    : (displayVal || '—')}
                </p>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </Modal>
  );
}

function TimelineTab({ timeline }) {
  return (
    <div>
      <h3 className="text-[14px] font-display font-semibold mb-4">Client Timeline</h3>
      {timeline.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No activity recorded yet</p>
      ) : (
        <div className="relative space-y-4 pl-6">
          <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />
          {timeline.map((event) => (
            <div key={event.id} className="relative">
              <div className="absolute -left-[18px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-background" />
              <p className="text-[13px] font-medium">{event.title}</p>
              {event.description && <p className="text-[12px] text-muted-foreground mt-0.5">{event.description}</p>}
              <p className="text-[11px] text-muted-foreground mt-1">{formatDate(event.created_date, 'MMM d, yyyy · h:mm a')} · {event.actor_name || 'System'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivateClientButton({ clientId, canOverride, onUpdated }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [open, setOpen] = useState(false);
  const [subId, setSubId] = useState('');
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Load the client's subscriptions + activation readiness on open.
  const loadData = async () => {
    setErr('');
    setSubId('');
    setOverrideConfirmed(false);
    const [subs, ready] = await Promise.all([
      SubscriptionsService.list({ client_id: clientId }).catch(() => []),
      ClientsService.activationReadiness(clientId).catch(() => null),
    ]);
    setSubscriptions(subs || []);
    setReadiness(ready);
    const active = (subs || []).find((s) => s.status === 'active') || (subs || [])[0];
    if (active) setSubId(active.id);
    setLoaded(true);
  };

  const handleOpen = async () => {
    setOpen(true);
    if (!loaded) await loadData();
  };

  const needsOverride = readiness ? readiness.required_plans_delivered === false : false;

  const handleActivate = async () => {
    setBusy(true);
    setErr('');
    try {
      if (needsOverride) {
        await SubscriptionsService.activateWithOverride(clientId);
      } else {
        if (!subId) { setErr('Please select a subscription to activate'); return; }
        await SubscriptionsService.activate(subId);
      }
      setOpen(false);
      onUpdated();
    } catch (e) {
      setErr(e.message || 'Activation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={handleOpen}>
        <Check className="w-4 h-4 mr-1" /> Activate Client
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={needsOverride ? 'Activate Client (Manual Override)' : 'Activate Client Package'} size="md">
        <div className="space-y-4">
          {err && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">{err}</div>
          )}
          {needsOverride ? (
            <>
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/25 text-[13px] text-amber-300">
                Required plans are not fully delivered yet — Nutrition: {readiness.nutrition_delivered ? 'delivered' : 'pending'} · Workout: {readiness.workout_delivered ? 'delivered' : 'pending'}. Automatic activation waits until BOTH are delivered; a manual override bypasses that rule and requires Platform/Workspace Owner authorization.
              </div>
              {canOverride ? (
                <label className="flex items-start gap-2 text-[13px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideConfirmed}
                    onChange={(e) => setOverrideConfirmed(e.target.checked)}
                    className="mt-0.5 text-primary focus:ring-primary"
                  />
                  <span>I authorize a manual activation override. The client will be marked as an intentional override and this action will be audited and excluded from automatic reconciliation.</span>
                </label>
              ) : (
                <p className="text-[13px] text-muted-foreground">Only a Platform Owner or the Workspace Owner can authorize a manual activation override.</p>
              )}
            </>
          ) : (
            <>
              <p className="text-[13px] text-muted-foreground">
                Activation requires both a delivered Nutrition plan and a delivered Workout plan.
                Clients are activated automatically the moment the second plan is delivered — this
                button re-checks the same rule server-side.
              </p>
              {subscriptions.length === 0 ? (
                <div className="p-3 rounded-md bg-primary/5 border border-primary/15 text-[13px] text-muted-foreground">
                  No subscriptions found. Assign a package to this client first.
                </div>
              ) : (
                <Select label="Subscription" value={subId} onChange={(e) => setSubId(e.target.value)}>
                  <option value="">Select subscription…</option>
                  {subscriptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.package_name || 'Package'} · {s.currency} {s.price} · {formatDate(s.start_date)}
                    </option>
                  ))}
                </Select>
              )}
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleActivate} disabled={busy || (needsOverride ? !(canOverride && overrideConfirmed) : subscriptions.length === 0)}>
              {busy ? 'Activating…' : needsOverride ? 'Activate (Override)' : 'Activate'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function EditClientModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState({ ...client });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      await ClientsService.update(client.id, form);
      onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit Client" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Full Name" value={form.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <Input label="Phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Date of Birth" type="date" value={form.date_of_birth || ''} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Height (cm)" type="number" value={form.height || ''} onChange={(e) => setForm({ ...form, height: parseFloat(e.target.value) })} />
          <Input label="Weight (kg)" type="number" value={form.current_weight || ''} onChange={(e) => setForm({ ...form, current_weight: parseFloat(e.target.value) })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Body Fat %" type="number" value={form.body_fat || ''} onChange={(e) => setForm({ ...form, body_fat: parseFloat(e.target.value) })} />
          <Select label="Follow-up Day" value={form.follow_up_day || ''} onChange={(e) => setForm({ ...form, follow_up_day: e.target.value })}>
            {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d) => (
              <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </Select>
        </div>
        <TextArea label="Notes" rows={3} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        </div>
      </div>
    </Modal>
  );
}
