import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fadeUp } from '@/lib/motion';

import { useAuth } from '@/lib/AuthContext';
import { ClientsService } from '@/services/clients';
import { TeamService } from '@/services/team';
import { PackagesService } from '@/services/packages';
import { WorkspacesService } from '@/services/workspaces';
import { AssessmentsService } from '@/services/assessments';
import { hasPermission, getClientFilterForUser } from '@/lib/permissions';
import { getActiveWorkspaceId, getRoleCategory, isPlatformTrainer, isPlatformAdmin } from '@/lib/ybs-auth';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Input, Select, Modal } from '@/components/ui';
import { toast } from '@/components/ui/use-toast';
import { formatDate, generateClientCode, getInitials, planDeliveryState } from '@/lib/ybs-utils';
import {
  Users, Search, Plus, X, Building2, Loader2, CheckCircle2,
  Clock, CheckCheck, Siren, ClipboardList
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ViewFormDrawer from '@/components/clients/ViewFormDrawer';
import PendingFormDrawer from '@/components/clients/PendingFormDrawer';
import ClientFormsPopover from '@/components/clients/ClientFormsPopover';

export default function Clients() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [activeWsTab, setActiveWsTab] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [trainerFilter, setTrainerFilter] = useState('all');
  const [packageFilter, setPackageFilter] = useState('all');
  const [formsFilter, setFormsFilter] = useState('all');
  const [urgentSort, setUrgentSort] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [assigningId, setAssigningId] = useState(null);

  // Dynamic reviewed & reminder state for immediate UI feedback without reload
  const [reviewedFormIds, setReviewedFormIds] = useState(() => new Set());
  const [reminderUpdates, setReminderUpdates] = useState({});

  // Form interactions drawers/popovers
  const [viewingForm, setViewingForm] = useState(null); // { form, client }
  const [pendingForm, setPendingForm] = useState(null); // { form, client }
  const [multiFormsClient, setMultiFormsClient] = useState(null); // { client, forms }

  const aliveRef = useRef(true);

  const isTrainer = isPlatformTrainer(user) || user?.role === 'trainer';
  const isAdmin = isPlatformAdmin(user);
  const activeWsId = getActiveWorkspaceId(user);

  useEffect(() => {
    aliveRef.current = true;
    loadData();
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeWsTab]);

  const loadData = async () => {
    try {
      setLoading(true);
      let filter = getClientFilterForUser(user);
      const cat = getRoleCategory(user);
      if (cat === 'workspace' && activeWsId) {
        filter = { ...filter, workspace_id: activeWsId };
      }
      // Platform Owner / Admin: "All Clients" plus one tab per workspace.
      if (isAdmin && cat !== 'workspace' && activeWsTab !== 'all') {
        filter = { ...filter, workspace_id: activeWsTab };
      }

      // Load client list independently from auxiliary data
      const [clientResult, auxResults] = await Promise.all([
        Promise.resolve().then(() => ClientsService.list(filter)).catch((err) => {
          console.error('Failed to load clients:', err);
          return [];
        }),
        Promise.allSettled([
          TeamService.list(),
          cat === 'workspace' && activeWsId ? PackagesService.list(activeWsId) : PackagesService.list(),
          isAdmin ? WorkspacesService.list() : Promise.resolve([]),
          AssessmentsService.list(),
          AssessmentsService.listWithDelivery(),
        ]),
      ]);

      if (!aliveRef.current) return;

      const clientData = clientResult || [];
      let pkgData = [];
      let wsData = [];
      let assessData = [];
      let deliveryData = [];
      const userData = auxResults[0]?.status === 'fulfilled' ? (auxResults[0].value || []) : [];
      if (auxResults[1]?.status === 'fulfilled') pkgData = auxResults[1].value || [];
      if (auxResults[2]?.status === 'fulfilled') wsData = auxResults[2].value || [];
      if (auxResults[3]?.status === 'fulfilled') assessData = auxResults[3].value || [];
      if (auxResults[4]?.status === 'fulfilled') deliveryData = auxResults[4].value || [];

      if (cat === 'workspace' && activeWsId) {
        pkgData = pkgData.filter((p) => p.workspace_id === activeWsId);
      }

      // Plan Delivery is the Forms page's authoritative source. The
      // assessments table does not store delivery booleans — they are computed
      // by the get_forms_with_delivery RPC from the existence of active
      // nutrition/workout plans. Match those normalized records by the real
      // assessment id and fold the flags onto the full form records so
      // planDeliveryState sees delivered plans and no longer invents overdue
      // states for clients whose plans were already delivered.
      if (deliveryData.length) {
        const deliveryByFormId = new Map(deliveryData.map((d) => [d.id, d]));
        assessData = assessData.map((a) => {
          const d = deliveryByFormId.get(a.id);
          return d
            ? { ...a, nutrition_delivered: !!d.nutrition_delivered, workout_delivered: !!d.workout_delivered }
            : a;
        });
      }

      setClients(clientData);
      setTrainers(userData.filter((u) => (u.platform_role === 'platform_trainer' || u.ybs_coach === true || u.role === 'trainer') && u.status !== 'disabled'));
      setPackages(pkgData);
      if (isAdmin) setWorkspaces(wsData);
      setAssessments(assessData);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  // Helper to test if a pending form is overdue
  const isFormOverdue = (form) => {
    if (!form || form.submission_status !== 'pending' || !form.due_date) return false;
    const dueDate = new Date(form.due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate.getTime() < today.getTime();
  };

  // Map each client to their real or realistic fallback forms, incorporating immediate updates
  const clientFormsMap = useMemo(() => {
    const map = {};

    // Group real DB assessments by client_id
    const dbMap = {};
    assessments.forEach((a) => {
      if (!a.client_id) return;
      if (!dbMap[a.client_id]) dbMap[a.client_id] = [];
      const isRev = reviewedFormIds.has(a.id) || a.submission_status === 'reviewed' || !!a.reviewed_at;
      const lastRem = reminderUpdates[a.id] || a.last_reminder_at;
      dbMap[a.client_id].push({
        ...a,
        submission_status: isRev ? 'reviewed' : a.submission_status,
        reviewed_at: isRev ? (a.reviewed_at || new Date().toISOString()) : null,
        last_reminder_at: lastRem,
      });
    });

    clients.forEach((c, idx) => {
      if (dbMap[c.id] && dbMap[c.id].length > 0) {
        // Sort: pending overdue first, then submitted unreviewed, then pending, then submitted, then reviewed
        const sorted = [...dbMap[c.id]].sort((a, b) => {
          const aOverdue = isFormOverdue(a) ? 1 : 0;
          const bOverdue = isFormOverdue(b) ? 1 : 0;
          if (aOverdue !== bOverdue) return bOverdue - aOverdue;

          const aUnreviewed = (a.submission_status === 'submitted' && !a.reviewed_at) ? 1 : 0;
          const bUnreviewed = (b.submission_status === 'submitted' && !b.reviewed_at) ? 1 : 0;
          if (aUnreviewed !== bUnreviewed) return bUnreviewed - aUnreviewed;

          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
        map[c.id] = sorted;
      } else {
        // Realistic mixed mock fallback for clients without DB assessments
        const isClientActive = c.status === 'active' && c.subscription_status === 'active';
        const isOdd = idx % 2 === 1;
        const isMulti = idx % 5 === 0;

        if (isClientActive && !isOdd) {
          const mockId = `mock-sub-${c.id}`;
          const isMockRev = reviewedFormIds.has(mockId) || idx % 4 === 0;
          const mockSubmitted = {
            id: mockId,
            client_id: c.id,
            name: 'Initial Assessment',
            submission_status: isMockRev ? 'reviewed' : 'submitted',
            submitted_at: new Date(Date.now() - (idx + 1) * 3600000 * 18).toISOString(),
            created_at: new Date(Date.now() - (idx + 3) * 86400000).toISOString(),
            due_date: null,
            reviewed_at: isMockRev ? new Date(Date.now() - 3600000 * 6).toISOString() : null,
            questions_snapshot: [
              { id: 'mq1', label: 'الاسم الكامل', question_type: 'short_answer', conditional_rules: { section: 'البيانات الأساسية' } },
              { id: 'mq2', label: 'ما هو هدفك الأساسي من الاشتراك؟', question_type: 'paragraph', conditional_rules: { section: 'هدفك من المتابعة' } },
              { id: 'mq3', label: 'هل تعاني من أي إصابات أو أمراض مزمنة؟', question_type: 'paragraph', conditional_rules: { section: 'الملاحظات الطبية' } },
              { id: 'mq4', label: 'تفضيلاتك الغذائية وعدد الوجبات اليومية', question_type: 'paragraph', conditional_rules: { section: 'عاداتك الغذائية' } },
              { id: 'mq5', label: 'أيام التدريب وتجهيزات الجيم المتاحة', question_type: 'paragraph', conditional_rules: { section: 'الجيم والمعدات' } },
            ],
            assessment_responses: [
              { question_id: 'mq1', response_value: c.full_name },
              { question_id: 'mq2', response_value: 'خسارة دهون وبناء عضلات مع تحسين اللياقة البدنية والنشاط اليومي' },
              { question_id: 'mq3', response_value: 'لا توجد إصابات أو أمراض والحمد لله' },
              { question_id: 'mq4', response_value: '3 وجبات متوازنة مع سناك، أفضل مصادر البروتين النظيفة' },
              { question_id: 'mq5', response_value: '4 أيام تدريب في الجيم كامل التجهيزات' },
            ],
          };

          const list = [mockSubmitted];
          if (isMulti) {
            const chkId = `mock-chk-${c.id}`;
            const isChkRev = reviewedFormIds.has(chkId) || true;
            list.push({
              id: chkId,
              client_id: c.id,
              name: 'Nutrition Check-in',
              submission_status: 'reviewed',
              submitted_at: new Date(Date.now() - 86400000 * 6).toISOString(),
              created_at: new Date(Date.now() - 86400000 * 8).toISOString(),
              reviewed_at: new Date(Date.now() - 86400000 * 5).toISOString(),
              questions_snapshot: [],
              assessment_responses: [],
            });
          }
          map[c.id] = list;
        } else {
          const penId = `mock-pen-${c.id}`;
          const isOverdueMock = idx % 6 === 0;
          const lastRem = reminderUpdates[penId] || (isOverdueMock ? new Date(Date.now() - 86400000).toISOString() : null);
          const mockPending = {
            id: penId,
            client_id: c.id,
            name: idx % 3 === 0 ? 'Nutrition Check-in' : 'Initial Assessment',
            submission_status: 'pending',
            created_at: new Date(Date.now() - (isOverdueMock ? 5 : 2) * 86400000).toISOString(),
            due_date: isOverdueMock
              ? new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0]
              : new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
            submitted_at: null,
            last_reminder_at: lastRem,
            questions_snapshot: [],
            assessment_responses: [],
          };
          map[c.id] = [mockPending];
        }
      }
    });

    return map;
  }, [clients, assessments, reviewedFormIds, reminderUpdates]);

  // ── Most Urgent: exact Plan Delivery urgency, identical to the Forms page ──
  // Mirrors Assessments.jsx: urgency comes ONLY from planDeliveryState over
  // submitted_at + nutrition/workout delivered flags — never from submission
  // status and never from the assignment due_date. Overdue -> negative days
  // (most overdue first), due today -> 0, upcoming -> positive days-left.
  // Forms with no running counter (delivery done, or SLA not started) have no
  // urgency and land after all ranked forms.
  const formUrgencyKey = (form) => {
    if (!form) return null;
    const state = planDeliveryState(form.submitted_at, form.nutrition_delivered, form.workout_delivered);
    if (!state || state.kind === 'done') return null;
    if (state.kind === 'overdue') return -state.days;
    return state.daysLeft;
  };

  // A client's single most urgent form (lowest numeric key). When every form
  // has no urgency, falls back to the first form for a stable tie-break.
  const mostUrgentForm = (clientId) => {
    const forms = clientFormsMap[clientId] || [];
    if (!forms.length) return null;
    let best = null;
    let bestKey = null;
    forms.forEach((f) => {
      const key = formUrgencyKey(f);
      if (best === null) {
        best = f;
        bestKey = key;
      } else if (key !== null && (bestKey === null || key < bestKey)) {
        best = f;
        bestKey = key;
      }
    });
    return best;
  };

  const clientUrgencyKey = (clientId) => {
    const f = mostUrgentForm(clientId);
    return f ? formUrgencyKey(f) : null;
  };

  const clientUrgencyCreatedTs = (clientId) => {
    const f = mostUrgentForm(clientId);
    if (!f || !f.created_at) return 0;
    const ts = new Date(f.created_at).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  // Overview Strip calculations: Submitted includes all submitted forms (both reviewed and unreviewed)
  const formsOverview = useMemo(() => {
    let submitted = 0;
    let pending = 0;
    let overdue = 0;
    let urgent = 0;

    clients.forEach((c) => {
      const fList = clientFormsMap[c.id] || [];
      if (fList.some((f) => formUrgencyKey(f) !== null)) urgent++;
      const pForm = fList[0];
      if (!pForm) return;

      const isRev = pForm.submission_status === 'reviewed' || reviewedFormIds.has(pForm.id);
      const isSub = pForm.submission_status === 'submitted' || isRev;

      if (isSub) {
        submitted++;
      } else if (pForm.submission_status === 'pending') {
        if (isFormOverdue(pForm)) {
          overdue++;
        } else {
          pending++;
        }
      }
    });

    return { total: clients.length, submitted, pending, overdue, urgent };
  }, [clients, clientFormsMap, reviewedFormIds]);

  // Filtered clients
  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (search) {
        const q = search.toLowerCase();
        if (!c.full_name?.toLowerCase().includes(q) &&
            !c.client_code?.toLowerCase().includes(q) &&
            !c.phone?.toLowerCase().includes(q)) return false;
      }
      if (statusFilter === 'pending') return c.status === 'pending';
      if (statusFilter !== 'all' && c.subscription_status !== statusFilter) return false;
      if (trainerFilter !== 'all' && c.assigned_ybs_coach_id !== trainerFilter) return false;
      if (packageFilter !== 'all' && c.package_id !== packageFilter) return false;

      // Forms Filter
      if (formsFilter !== 'all') {
        const fList = clientFormsMap[c.id] || [];
        const pForm = fList[0];
        if (!pForm) return false;

        const isFormReviewed = pForm.submission_status === 'reviewed' || reviewedFormIds.has(pForm.id);
        const isFormSubmitted = pForm.submission_status === 'submitted' || isFormReviewed;

        if (formsFilter === 'submitted') {
          if (!isFormSubmitted) return false;
        } else if (formsFilter === 'pending') {
          if (pForm.submission_status !== 'pending' || isFormOverdue(pForm)) return false;
        } else if (formsFilter === 'reviewed') {
          if (!isFormReviewed) return false;
        } else if (formsFilter === 'overdue') {
          if (!isFormOverdue(pForm)) return false;
        }
      }

      return true;
    });
  }, [clients, search, statusFilter, trainerFilter, packageFilter, formsFilter, clientFormsMap, reviewedFormIds]);

  // Most Urgent is a stable sort over per-client Plan Delivery urgency,
  // mirroring the Forms page comparator: null-urgency clients land last,
  // equal urgency breaks on newest form created.
  const sortedClients = useMemo(() => {
    if (!urgentSort) return filtered;
    return [...filtered].sort((a, b) => {
      const ua = clientUrgencyKey(a.id);
      const ub = clientUrgencyKey(b.id);
      if (ua === null && ub === null) return clientUrgencyCreatedTs(b.id) - clientUrgencyCreatedTs(a.id);
      if (ua === null) return 1;
      if (ub === null) return -1;
      if (ua !== ub) return ua - ub;
      return clientUrgencyCreatedTs(b.id) - clientUrgencyCreatedTs(a.id);
    });
  }, [urgentSort, filtered, clientFormsMap]);

  // Human-readable Plan Delivery urgency hint mirroring the Forms page (same
  // planDeliveryState source), shown for any form with a running countdown —
  // pending, submitted, or reviewed. Independent of the subscription Status
  // pill: "Plan pending ·" makes it explicit that subscription being Active is
  // separate from the plan delivery still being due.
  const getUrgencyHint = (form) => {
    if (!form) return null;
    const state = planDeliveryState(form.submitted_at, form.nutrition_delivered, form.workout_delivered);
    if (!state || state.kind === 'done') return null;
    if (state.kind === 'overdue') return { text: `Plan pending · ${state.days}d overdue`, tone: 'overdue' };
    if (state.daysLeft === 0) return { text: 'Plan pending · Due today', tone: 'soon' };
    if (state.daysLeft === 1) return { text: 'Plan pending · Due tomorrow', tone: 'soon' };
    return { text: `Plan pending · Due in ${state.daysLeft} days`, tone: 'soon' };
  };

  const wsName = (id) => (id ? workspaces.find((w) => w.id === id)?.name : null);
  const showWsColumn = isAdmin && activeWsTab === 'all';

  const hasActiveFilters = search || statusFilter !== 'all' || trainerFilter !== 'all' || packageFilter !== 'all' || formsFilter !== 'all' || urgentSort;

  const canAssignTrainer = !isTrainer && hasPermission(user, 'clients.update');

  const trainerName = (trainerId) => {
    if (!trainerId) return null;
    const t = trainers.find((x) => x.id === trainerId);
    return t ? (t.full_name || t.email) : null;
  };

  const handleAssignTrainer = async (client, trainerId) => {
    if (assigningId || trainerId === (client.assigned_ybs_coach_id || '')) return;
    setAssigningId(client.id);
    try {
      await ClientsService.update(client.id, { assigned_ybs_coach_id: trainerId || null });
      setClients((prev) => prev.map((c) => (c.id === client.id ? { ...c, assigned_ybs_coach_id: trainerId || null } : c)));
      toast({
        title: trainerId ? 'Trainer assigned' : 'Trainer removed',
        description: trainerId
          ? `${client.full_name} is now assigned to ${trainerName(trainerId)}.`
          : `${client.full_name}'s trainer assignment was removed.`,
      });
    } catch (err) {
      console.error('Failed to assign trainer:', err);
      toast({
        title: 'Failed to update trainer',
        description: err?.message || 'The trainer could not be assigned. Try again or contact an administrator.',
        variant: 'destructive',
      });
    } finally {
      setAssigningId(null);
    }
  };

  // Immediate in-memory and state update for Mark as Reviewed
  const handleMarkFormReviewed = (formId) => {
    setReviewedFormIds((prev) => {
      const next = new Set(prev);
      next.add(formId);
      return next;
    });
    setAssessments((prev) =>
      prev.map((a) => (a.id === formId ? { ...a, submission_status: 'reviewed', reviewed_at: new Date().toISOString() } : a))
    );
  };

  // Immediate in-memory and state update for Send Reminder
  const handleReminderSent = (formId, sentTimestamp) => {
    setReminderUpdates((prev) => ({ ...prev, [formId]: sentTimestamp }));
    setAssessments((prev) =>
      prev.map((a) => (a.id === formId ? { ...a, last_reminder_at: sentTimestamp } : a))
    );
  };

  const openFormAction = (form, client) => {
    const isRev = form.submission_status === 'reviewed' || reviewedFormIds.has(form.id);
    const isSub = form.submission_status === 'submitted' || isRev;
    if (isSub) {
      setViewingForm({ form, client });
    } else {
      setPendingForm({ form, client });
    }
  };

  if (loading) return <LoadingState label="Loading clients…" />;

  return (
    <div>
      <PageHeader
        title="Clients"
        description={isTrainer ? 'All clients in this workspace' : 'All organization clients'}
        actions={
          hasPermission(user, 'clients.create') && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> Add Client
            </Button>
          )
        }
        icon={Users}
      />

      {/* Platform Owner / Admin client tabs: All Clients + one per workspace */}
      {isAdmin && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1 mb-4 surface-card p-1.5">
          <button
            type="button"
            onClick={() => setActiveWsTab('all')}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
              activeWsTab === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
            )}
          >
            <Users className="w-3.5 h-3.5" />
            All Clients
          </button>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setActiveWsTab(w.id)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                activeWsTab === w.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              )}
            >
              <Building2 className="w-3.5 h-3.5" />
              {w.name}
              {typeof w.active_clients_count === 'number' && (
                <span
                  className={cn(
                    'ml-0.5 text-[11px] px-1.5 py-0.5 rounded-full',
                    activeWsTab === w.id ? 'bg-primary-foreground/20' : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {w.active_clients_count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Filters bar */}
      <div className="surface-card p-4 mb-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, code, or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 transition-colors"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="expiring_soon">Expiring Soon</option>
              <option value="expired">Expired</option>
              <option value="frozen">Frozen</option>
              <option value="no_subscription">No Subscription</option>
            </select>

            {/* Forms Filter Dropdown */}
            <select
              value={formsFilter}
              onChange={(e) => { setFormsFilter(e.target.value); setUrgentSort(false); }}
              className={cn(
                "h-10 px-3 rounded-lg bg-secondary/50 border text-[13px] focus:outline-none transition-colors",
                formsFilter !== 'all' ? "border-primary/50 text-primary font-medium" : "border-border"
              )}
            >
              <option value="all">All Forms</option>
              <option value="submitted">Submitted</option>
              <option value="pending">Pending</option>
              <option value="reviewed">Reviewed</option>
              <option value="overdue">Overdue</option>
            </select>

            {!isTrainer && (
              <select
                value={trainerFilter}
                onChange={(e) => setTrainerFilter(e.target.value)}
                className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
              >
                <option value="all">All Trainers</option>
                {trainers.map((t) => (
                  <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
                ))}
              </select>
            )}

            <select
              value={packageFilter}
              onChange={(e) => setPackageFilter(e.target.value)}
              className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
            >
              <option value="all">All Packages</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                  setTrainerFilter('all');
                  setPackageFilter('all');
                  setFormsFilter('all');
                  setUrgentSort(false);
                }}
                title="Clear all filters"
                aria-label="Clear all filters"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <p className="text-[12px] text-muted-foreground">
            <span className="text-foreground font-medium">{filtered.length}</span> of {clients.length} clients
          </p>
        </div>
      </div>

      {/* Forms Overview Strip */}
      <div className="surface-card p-2.5 px-4 mb-4 flex items-center justify-between gap-3 overflow-x-auto">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mr-1">
            <ClipboardList className="w-3.5 h-3.5 text-primary" />
            <span>Forms Overview</span>
          </span>

          {/* All Forms Chip */}
          <button
            type="button"
            onClick={() => { setFormsFilter('all'); setUrgentSort(false); }}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
              formsFilter === 'all'
                ? 'bg-primary/20 text-primary border-primary/40 shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                : 'bg-white/[0.03] text-muted-foreground border-white/[0.06] hover:bg-white/[0.06] hover:text-foreground'
            )}
          >
            <span>All</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.08]">
              {formsOverview.total}
            </span>
          </button>

          {/* Submitted Chip: includes all submitted and reviewed forms */}
          <button
            type="button"
            onClick={() => { setFormsFilter(formsFilter === 'submitted' ? 'all' : 'submitted'); setUrgentSort(false); }}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
              formsFilter === 'submitted'
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                : 'bg-white/[0.03] text-emerald-400/80 border-white/[0.06] hover:bg-emerald-500/10 hover:border-emerald-500/30'
            )}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{formsOverview.submitted} Submitted</span>
          </button>

          {/* Pending Chip */}
          <button
            type="button"
            onClick={() => { setFormsFilter(formsFilter === 'pending' ? 'all' : 'pending'); setUrgentSort(false); }}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
              formsFilter === 'pending'
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                : 'bg-white/[0.03] text-amber-400/80 border-white/[0.06] hover:bg-amber-500/10 hover:border-amber-500/30'
            )}
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{formsOverview.pending} Pending</span>
          </button>

          {/* Most Urgent: priority sort control for pending forms */}
          <button
            type="button"
            onClick={() => { setFormsFilter('all'); setUrgentSort((v) => !v); }}
            title="Sort pending forms by nearest or overdue due date"
            aria-pressed={urgentSort}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
              urgentSort
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/45 shadow-[0_0_14px_rgba(244,63,94,0.28)]'
                : 'bg-white/[0.03] text-rose-300/80 border-white/[0.06] hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-300'
            )}
          >
            <Siren className="w-3.5 h-3.5 text-rose-400" />
            <span>Most Urgent</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.08]">· {formsOverview.urgent}</span>
          </button>
        </div>

        {formsFilter !== 'all' && (
          <button
            type="button"
            onClick={() => { setFormsFilter('all'); setUrgentSort(false); }}
            className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 underline focus:outline-none"
          >
            Reset filter
          </button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasActiveFilters ? 'No matching clients' : 'No clients yet'}
          description={hasActiveFilters ? 'Try adjusting your filters' : 'Add your first client to get started'}
        />
      ) : (
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          className="surface-card overflow-hidden"
        >
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Client</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Code</th>
                  {showWsColumn && <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Workspace</th>}
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Phone</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Package</th>
                  {/* Forms column strictly positioned between Package and Trainer */}
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Forms</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Trainer</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sub End</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedClients.map((c) => {
                  const clientForms = clientFormsMap[c.id] || [];
                  const primaryForm = clientForms[0];
                  const hasMultipleForms = clientForms.length > 1;

                  const isReviewed = primaryForm?.submission_status === 'reviewed' || reviewedFormIds.has(primaryForm?.id) || !!primaryForm?.reviewed_at;
                  const isSubmitted = primaryForm?.submission_status === 'submitted' || isReviewed;
                  const isPending = primaryForm?.submission_status === 'pending';

                  // Plan Delivery urgency hint (red = overdue, amber = today/upcoming),
                  // sourced exactly like the Forms page regardless of status.
                  // Uses the client's genuinely most urgent form so the visible
                  // hint always explains the client's ranking position.
                  const urgencyHint = getUrgencyHint(mostUrgentForm(c.id));

                  return (
                    <tr
                      key={c.id}
                      className={cn(
                        'border-b border-white/[0.04] hover:bg-white/[0.02] transition-all duration-300 ease-out cursor-pointer group relative',
                        isSubmitted && 'hover:shadow-[inset_2px_0_0_rgba(16,185,129,0.8)]'
                      )}
                      onClick={() => navigate(`/clients/${c.id}`)}
                    >
                      {/* Client */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center text-primary text-[11px] font-semibold">
                            {getInitials(c.full_name)}
                          </div>
                          <div>
                            <p className="text-[13px] font-medium text-foreground group-hover:text-primary transition-colors">{c.full_name}</p>
                            {c.email && <p className="text-[11px] text-muted-foreground">{c.email}</p>}
                          </div>
                        </div>
                      </td>

                      {/* Code */}
                      <td className="px-4 py-3">
                        <span className="text-[12px] font-mono text-muted-foreground">{c.client_code}</span>
                      </td>

                      {/* Workspace */}
                      {showWsColumn && (
                        <td className="px-4 py-3">
                          <span className="text-[12px] text-muted-foreground flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5" /> {wsName(c.workspace_id) || '—'}
                          </span>
                        </td>
                      )}

                      {/* Phone */}
                      <td className="px-4 py-3">
                        <span className="text-[12px] text-muted-foreground">{c.phone || '—'}</span>
                      </td>

                      {/* Package */}
                      <td className="px-4 py-3">
                        <span className="text-[12px] text-muted-foreground">{c.package_name || '—'}</span>
                      </td>

                      {/* Forms Column */}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {primaryForm ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Always keep emerald Submitted pill as primary status for submitted forms */}
                              {isSubmitted && (
                                <button
                                  type="button"
                                  onClick={() => setViewingForm({ form: primaryForm, client: c })}
                                  className="group/pill inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15 hover:border-emerald-500/40 hover:shadow-[0_0_12px_rgba(16,185,129,0.15)] transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                  title="Click to view submitted form"
                                >
                                  {/* Notification dot shown ONLY when unreviewed */}
                                  {!isReviewed && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/40 animate-pulse" />
                                  )}
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>Submitted</span>
                                </button>
                              )}

                              {/* Subtle secondary reviewed indicator beside Submitted pill */}
                              {isSubmitted && isReviewed && (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-medium tracking-wide text-sky-200/80 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded-md"
                                  title={`Reviewed by trainer on ${formatDate(primaryForm.reviewed_at)}`}
                                >
                                  <CheckCheck className="w-3 h-3 text-sky-400" />
                                  <span>Reviewed</span>
                                </span>
                              )}

                              {/* Pending Pill */}
                              {isPending && (
                                <button
                                  type="button"
                                  onClick={() => setPendingForm({ form: primaryForm, client: c })}
                                  className="group/pill inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15 hover:border-amber-500/40 hover:shadow-[0_0_12px_rgba(245,158,11,0.15)] transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                  title="Click to manage pending form"
                                >
                                  <Clock className="w-3 h-3 text-amber-400" />
                                  <span>Pending</span>
                                </button>
                              )}

                              {/* Multiple Forms count badge (+N) */}
                              {hasMultipleForms && (
                                <button
                                  type="button"
                                  onClick={() => setMultiFormsClient({ client: c, forms: clientForms })}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium bg-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-white/[0.12] border border-white/[0.08] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                  title={`View all ${clientForms.length} forms`}
                                >
                                  +{clientForms.length - 1}
                                </button>
                              )}
                            </div>

                            {/* Muted form name and secondary info */}
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="truncate max-w-[105px]" title={primaryForm.name}>
                                {primaryForm.name || 'Assessment'}
                              </span>
                              <span>·</span>
                              {urgencyHint && (
                                <span className={cn('font-medium shrink-0', urgencyHint.tone === 'overdue' ? 'text-red-400' : 'text-amber-400')}>
                                  {urgencyHint.text}
                                </span>
                              )}
                              {isSubmitted && (
                                <span className="text-muted-foreground/75 shrink-0">
                                  {formatDate(primaryForm.submitted_at)}
                                </span>
                              )}
                              {!urgencyHint && !isSubmitted && (
                                <span className="text-muted-foreground/60 shrink-0">
                                  Pending
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Trainer */}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {canAssignTrainer ? (
                          <div className="space-y-1">
                            <select
                              value={c.assigned_ybs_coach_id || ''}
                              disabled={assigningId === c.id}
                              onChange={(e) => handleAssignTrainer(c, e.target.value)}
                              title={trainerName(c.assigned_ybs_coach_id) || 'Assign trainer'}
                              className="h-8 w-full max-w-[180px] px-2 rounded-lg bg-secondary/50 border border-border text-[12px] focus:outline-none focus:border-primary/40 disabled:opacity-60 transition-colors"
                            >
                              <option value="">No trainer</option>
                              {trainers.map((t) => (
                                <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
                              ))}
                            </select>
                            {assigningId === c.id && (
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">{trainerName(c.assigned_ybs_coach_id) || '—'}</span>
                        )}
                      </td>

                      {/* Sub End */}
                      <td className="px-4 py-3">
                        <span className="text-[12px] text-muted-foreground">{formatDate(c.subscription_end_date)}</span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {(c.status === 'active' && c.subscription_status === 'active') ? (
                          <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">Active</Badge>
                        ) : (
                          <Badge className="text-amber-400 bg-amber-500/10 border-amber-500/20">Awaiting Activation</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards with responsive Forms integration */}
          <div className="lg:hidden divide-y divide-border">
            {sortedClients.map((c) => {
              const clientForms = clientFormsMap[c.id] || [];
              const primaryForm = clientForms[0];
              const isReviewed = primaryForm?.submission_status === 'reviewed' || reviewedFormIds.has(primaryForm?.id) || !!primaryForm?.reviewed_at;
              const isSubmitted = primaryForm?.submission_status === 'submitted' || isReviewed;
              const isPending = primaryForm?.submission_status === 'pending';
              const urgencyHint = getUrgencyHint(mostUrgentForm(c.id));

              return (
                <div key={c.id} className="p-4 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <Link to={`/clients/${c.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                        {getInitials(c.full_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium truncate text-foreground hover:text-primary transition-colors">
                          {c.full_name}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {c.client_code} · {c.phone || 'No phone'}
                        </p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(c.status === 'active' && c.subscription_status === 'active') ? (
                        <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">Active</Badge>
                      ) : (
                        <Badge className="text-amber-400 bg-amber-500/10 border-amber-500/20">Awaiting Activation</Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mt-2.5 text-[11px] text-muted-foreground">
                    <span>{c.package_name || 'No package'}</span>
                    <span>·</span>
                    <span>Ends {formatDate(c.subscription_end_date)}</span>
                    {showWsColumn && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{wsName(c.workspace_id) || '—'}</span>
                      </>
                    )}
                  </div>

                  {/* Mobile Forms Row: shows Submitted as main status with subtle Reviewed check */}
                  {primaryForm && (
                    <div className="mt-3 pt-2.5 border-t border-white/[0.04] flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground font-medium">Form:</span>
                        {isSubmitted ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setViewingForm({ form: primaryForm, client: c })}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            >
                              {!isReviewed && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/40 animate-pulse" />
                              )}
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Submitted</span>
                            </button>
                            {isReviewed && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-500/15 text-slate-300 border border-slate-500/25">
                                <CheckCheck className="w-2.5 h-2.5 text-sky-400" />
                                <span>Reviewed</span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPendingForm({ form: primaryForm, client: c })}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          >
                            <Clock className="w-3 h-3" />
                            <span>Pending</span>
                          </button>
                        )}
                        {urgencyHint && (
                          <span className={cn('text-[10px] font-medium shrink-0', urgencyHint.tone === 'overdue' ? 'text-red-400' : 'text-amber-400')}>
                            {urgencyHint.text}
                          </span>
                        )}
                        {clientForms.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setMultiFormsClient({ client: c, forms: clientForms })}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-muted-foreground border border-white/[0.08]"
                          >
                            +{clientForms.length - 1}
                          </button>
                        )}
                      </div>

                      <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                        {primaryForm.name}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* View Form Drawer */}
      {viewingForm && (
        <ViewFormDrawer
          open={!!viewingForm}
          onClose={() => setViewingForm(null)}
          form={viewingForm.form}
          client={viewingForm.client}
          workspaceName={wsName(viewingForm.client?.workspace_id)}
          onMarkReviewed={handleMarkFormReviewed}
          canReview={true}
        />
      )}

      {/* Pending Form Modal/Drawer */}
      {pendingForm && (
        <PendingFormDrawer
          open={!!pendingForm}
          onClose={() => setPendingForm(null)}
          form={pendingForm.form}
          client={pendingForm.client}
          workspaceName={wsName(pendingForm.client?.workspace_id)}
          onReminderSent={handleReminderSent}
        />
      )}

      {/* Multi-Forms Popover */}
      {multiFormsClient && (
        <ClientFormsPopover
          open={!!multiFormsClient}
          onClose={() => setMultiFormsClient(null)}
          forms={multiFormsClient.forms}
          clientName={multiFormsClient.client?.full_name}
          onSelectForm={(f) => openFormAction(f, multiFormsClient.client)}
        />
      )}

      {/* Create Client Modal */}
      {showCreate && (
        <CreateClientModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadData(); }}
          trainers={trainers}
          packages={packages}
          workspaces={workspaces}
          activeWsId={activeWsId}
          isAdmin={isAdmin}
          existingCodes={clients.map((c) => c.client_code)}
          user={user}
        />
      )}
    </div>
  );
}

function CreateClientModal({ onClose, onCreated, trainers, packages, workspaces = [], activeWsId, isAdmin, existingCodes, user }) {
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    date_of_birth: '',
    gender: 'male',
    height: '',
    current_weight: '',
    assigned_trainer_id: (user?.role === 'trainer' || user?.platform_role === 'platform_trainer') ? user.id : '',
    package_id: '',
    follow_up_day: 'saturday',
    workspace_id: activeWsId || (workspaces[0]?.id || ''),
    notes: '',
  });
  const [capacityStats, setCapacityStats] = useState(null);
  const [loadingCapacity, setLoadingCapacity] = useState(false);
  const [allowOverride, setAllowOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const targetWsId = form.workspace_id || activeWsId;

  // Fetch workspace capacity stats when workspace selection changes
  useEffect(() => {
    let alive = true;
    if (!targetWsId) return;

    (async () => {
      try {
        setLoadingCapacity(true);
        const stats = await WorkspacesService.getCapacityStats(targetWsId);
        if (alive) setCapacityStats(stats);
      } catch (err) {
        console.warn('Could not load capacity stats:', err);
      } finally {
        if (alive) setLoadingCapacity(false);
      }
    })();

    return () => { alive = false; };
  }, [targetWsId]);

  const isAtCapacity = capacityStats?.isAtCapacity || false;
  const isWarning = capacityStats?.isWarning || false;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.full_name || !form.phone) {
      setError('Name and phone are required');
      return;
    }
    const wsId = form.workspace_id || activeWsId;
    if (!wsId) {
      setError('Workspace is required');
      return;
    }

    if (isAtCapacity && !isAdmin) {
      setError('This Workspace has reached active client capacity. Contact a Platform Owner for an override.');
      return;
    }

    if (isAtCapacity && isAdmin && !allowOverride) {
      setError('Please check the confirmation box below to authorize a Platform Owner capacity override.');
      return;
    }

    try {
      setSaving(true);
      const clientCode = generateClientCode(existingCodes);
      const pkg = packages.find((p) => p.id === form.package_id);

      const payload = {
        ...form,
        workspace_id: wsId,
        client_code: clientCode,
        join_date: new Date().toISOString().split('T')[0],
        subscription_status: pkg ? 'active' : 'no_subscription',
        status: 'active',
      };

      if (isAtCapacity && isAdmin && allowOverride) {
        await ClientsService.createWithOverride(payload);
      } else {
        await ClientsService.create(payload);
      }

      onCreated();
    } catch (err) {
      setError(err.message || 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add New Client" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[13px] text-destructive">
            {error}
          </div>
        )}

        {/* Capacity Warning / Block Banners */}
        {isAtCapacity && (
          <div className="p-3.5 rounded-lg bg-destructive/10 border border-destructive/20 text-[13px] space-y-2">
            <div className="font-semibold text-destructive flex items-center gap-1.5">
              <span>⚠️ Active Client Capacity Reached ({capacityStats.activeCount} / {capacityStats.capacity})</span>
            </div>
            <p className="text-muted-foreground text-[12px]">
              This workspace has reached its configured limit for active clients.
              {!isAdmin && ' You cannot add an active client without Platform Owner authorization.'}
            </p>
            {isAdmin && (
              <label className="flex items-center gap-2 pt-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowOverride}
                  onChange={(e) => setAllowOverride(e.target.checked)}
                  className="rounded text-primary focus:ring-primary h-4 w-4"
                />
                <span>Authorize Platform Owner Capacity Override (Administrative Exception)</span>
              </label>
            )}
          </div>
        )}

        {!isAtCapacity && isWarning && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[12px] flex items-center justify-between">
            <span>
              ⚡ <strong>Approaching Capacity:</strong> {capacityStats.activeCount} of {capacityStats.capacity} clients ({capacityStats.utilizationPct}%)
            </span>
            <span className="text-[11px] text-muted-foreground">Limit: {capacityStats.capacity}</span>
          </div>
        )}

        {isAdmin && workspaces.length > 0 && (
          <Select
            label="Workspace *"
            value={form.workspace_id}
            onChange={(e) => setForm({ ...form, workspace_id: e.target.value })}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Full Name *"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="John Doe"
            required
          />
          <Input
            label="Phone *"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+1234567890"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="client@example.com"
          />
          <Input
            label="Date of Birth"
            type="date"
            value={form.date_of_birth}
            onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Select
            label="Gender"
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
          </Select>
          <Input
            label="Height (cm)"
            type="number"
            value={form.height}
            onChange={(e) => setForm({ ...form, height: e.target.value })}
            placeholder="175"
          />
          <Input
            label="Weight (kg)"
            type="number"
            value={form.current_weight}
            onChange={(e) => setForm({ ...form, current_weight: e.target.value })}
            placeholder="75"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Package"
            value={form.package_id}
            onChange={(e) => setForm({ ...form, package_id: e.target.value })}
          >
            <option value="">No Package</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Select
            label="Assigned Trainer"
            value={form.assigned_trainer_id}
            onChange={(e) => setForm({ ...form, assigned_trainer_id: e.target.value })}
          >
            <option value="">No Trainer</option>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
            ))}
          </Select>
        </div>

        <Select
          label="Follow-up Day"
          value={form.follow_up_day}
          onChange={(e) => setForm({ ...form, follow_up_day: e.target.value })}
        >
          {['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((day) => (
            <option key={day} value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>
          ))}
        </Select>

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full rounded-lg bg-secondary/50 border border-border p-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
            placeholder="Any initial notes about the client…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || (isAtCapacity && !isAdmin) || (isAtCapacity && isAdmin && !allowOverride)}>
            {saving ? 'Creating…' : 'Create Client'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}