import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { getActiveWorkspaceId } from '@/lib/ybs-auth';
import { supabase } from '@/utils/supabase';
import { ClientsService } from '@/services/clients';
import { AssessmentsService } from '@/services/assessments';
import { SubscriptionsService } from '@/services/subscriptions';
import { PackagesService } from '@/services/packages';
import { WorkspacesService } from '@/services/workspaces';
import { hasPermission, canViewFinancials, isPlatformAdmin } from '@/lib/permissions';
import { PageHeader, StatCard, LoadingState, Badge, Button } from '@/components/ui';
import { formatDate, formatCurrency } from '@/lib/ybs-utils';
import {
  Users, UserCheck, AlertTriangle, CalendarCheck, FileClock,
  DollarSign, ArrowRight, Building2, ClipboardCheck, UsersRound,
  AlertCircle, Handshake, ShieldAlert, Apple, Dumbbell, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { cardGridVariants, fadeUp } from '@/lib/motion';

const QUICK_ACTIONS = [
  { label: 'Clients', to: '/clients', perm: 'clients.view', icon: Users },
  { label: 'Forms', to: '/forms', perm: 'forms.view', icon: FileClock },
  { label: 'Pending Approvals', to: '/admin/applications', perm: 'applications.view', icon: ClipboardCheck },
  { label: 'Workspaces', to: '/admin/workspaces', perm: 'workspaces.view', icon: Building2 },
  { label: 'Nutrition Plans', to: '/nutrition', perm: 'nutrition.view', icon: Apple },
  { label: 'Exercise Plans', to: '/workouts', perm: 'workout.view', icon: Dumbbell },
];

const scrollToFinancial = () => {
  const el = document.getElementById('ybs-financial-overview');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export default function Dashboard() {
  const { user } = useAuth();
  const { workspaceId } = useParams();
  const effectiveWsId = workspaceId || getActiveWorkspaceId(user);

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({});
  const [workspaceStats, setWorkspaceStats] = useState(null);

  const [pendingForms, setPendingForms] = useState([]);
  const [revenueData, setRevenueData] = useState(null);
  const [adminStats, setAdminStats] = useState({ activeWorkspaces: 0, pendingApprovals: 0, ybsTrainers: 0 });

  const isAdmin = isPlatformAdmin(user);

  useEffect(() => {
    loadDashboard();
  }, [user, effectiveWsId]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const isTrainer = user?.role === 'trainer' || user?.platform_role === 'platform_trainer';
      const clientFilter = isTrainer ? { assigned_ybs_coach_id: user.id } : {};

      const promises = [
        ClientsService.list(clientFilter),
        AssessmentsService.list({}),
        SubscriptionsService.list(),
        PackagesService.list(),
      ];

      if (isAdmin) {
        promises.push(WorkspacesService.list().catch(() => []));
        promises.push(supabase.from('client_applications').select('*').eq('status', 'pending').then((r) => r.data || []));
        promises.push(supabase.from('profiles').select('*').eq('platform_role', 'platform_trainer').then((r) => r.data || []));
      }

      // Always query target workspace capacity stats if available
      promises.push(effectiveWsId ? WorkspacesService.getCapacityStats(effectiveWsId).catch(() => null) : Promise.resolve(null));

      const results = await Promise.all(promises);
      const clients = results[0] || [];
      const forms = results[1] || [];
      const subscriptions = results[2] || [];
      const packages = results[3] || [];

      if (isAdmin) {
        const wsList = results[4] || [];
        const pendingApps = results[5] || [];
        const allUsers = results[6] || [];
        const trainerUsers = allUsers.filter(u => u.platform_role === 'platform_trainer' || u.ybs_coach === true);
        setAdminStats({
          activeWorkspaces: wsList.filter(w => w.status === 'active').length,
          pendingApprovals: pendingApps.length,
          ybsTrainers: trainerUsers.length,
        });
        setWorkspaceStats(results[7]);
      } else {
        setWorkspaceStats(results[4]);
      }


      const today = new Date().toISOString().split('T')[0];

      // Client stats
      const activeClients = clients.filter((c) => c.subscription_status === 'active');
      const expiredClients = clients.filter((c) => c.subscription_status === 'expired');
      const expiringSoon = clients.filter((c) => c.subscription_status === 'expiring_soon');

      // Form stats
      const pending = forms.filter((f) => f.submission_status === 'pending');
      const overdue = forms.filter((f) => f.submission_status === 'overdue' || (f.submission_status === 'pending' && f.due_date && f.due_date < today));
      const unreviewed = forms.filter((f) => f.submission_status === 'submitted');

      // Today's check-ins (follow-up day = today)
      const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const todayCheckins = clients.filter((c) => c.follow_up_day === dayName);

      setStats({
        activeClients: activeClients.length,
        expiredClients: expiredClients.length,
        expiringSoon: expiringSoon.length,
        todayCheckins: todayCheckins.length,
        pendingForms: pending.length,
        overdueForms: overdue.length,
        unreviewedForms: unreviewed.length,
        totalClients: clients.length,
      });

      setPendingForms(unreviewed.slice(0, 5));

      // Financial data — owner only
      if (canViewFinancials(user)) {
        const paidSubs = subscriptions.filter((s) => s.payment_status === 'paid');
        const totalRevenue = paidSubs.reduce((sum, s) => sum + (s.price || 0), 0);
        const activeSubValue = subscriptions
          .filter((s) => s.status === 'active')
          .reduce((sum, s) => sum + (s.price || 0), 0);

        // Revenue by package
        const revByPkg = {};
        paidSubs.forEach((s) => {
          const key = s.package_name || 'Unknown';
          revByPkg[key] = (revByPkg[key] || 0) + (s.price || 0);
        });

        setRevenueData({
          totalRevenue,
          activeSubValue,
          renewals: subscriptions.filter((s) => s.status === 'renewed').length,
          expired: expiredClients.length,
          revByPkg,
        });
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingState label="Loading dashboard…" />;

  return (
    <div>
      <PageHeader
        title={isAdmin ? "Platform Owner Dashboard" : "Dashboard"}
        description={isAdmin ? "YBS Platform overview, workspaces, pending approvals, and operational health" : user?.role === 'trainer' ? 'Your assigned client portfolio overview' : 'Workspace overview and key metrics'}
      />

      {/* Operational Alert banner for admin */}
      {isAdmin && adminStats.pendingApprovals > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/[0.08] border border-amber-500/25 shadow-[inset_2px_0_0_hsl(var(--warning))] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
              <AlertCircle className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{adminStats.pendingApprovals} Client Application{adminStats.pendingApprovals > 1 ? 's' : ''} Awaiting Review</p>
              <p className="text-xs text-muted-foreground">New clients have self-registered and require workspace assignment and trainer allocation.</p>
            </div>
          </div>
          <Link to="/admin/applications">
            <Button size="sm" className="shrink-0 bg-amber-500 hover:bg-amber-600 text-black font-semibold shadow-[0_0_16px_hsl(var(--warning)/0.3)]">Review Approvals</Button>
          </Link>
        </div>
      )}

      {/* Workspace Operational & Capacity Strip (Section 22) */}
      {workspaceStats && (
        <div className="surface-card p-4 mb-6 border border-border bg-gradient-to-br from-[hsl(var(--card))] to-[hsl(var(--background))] shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-foreground">
                  {workspaceStats.workspaceName}
                </span>
                {workspaceStats.partnershipType && (
                  <Badge variant="outline" className="text-primary bg-primary/5 border-primary/20 text-[12px]">
                    <Handshake className="w-3 h-3 mr-1" />
                    {workspaceStats.partnershipType.name}
                  </Badge>
                )}
                {workspaceStats.isAtCapacity ? (
                  <Badge variant="destructive" className="flex items-center gap-1 text-[12px]">
                    <ShieldAlert className="w-3 h-3" /> Capacity Reached (100%)
                  </Badge>
                ) : workspaceStats.isWarning ? (
                  <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 text-[12px]">
                    <AlertTriangle className="w-3 h-3" /> Approaching Limit ({workspaceStats.utilizationPct}%)
                  </Badge>
                ) : null}
              </div>
              <p className="text-[12px] text-muted-foreground">
                Assigned YBS Trainers: <strong className="text-foreground">{workspaceStats.assignedTrainersCount}</strong>
              </p>
            </div>

            {/* Capacity gauge and progress */}
            <div className="lg:w-72 space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted-foreground">Active Client Capacity:</span>
                <span className="font-semibold text-foreground">
                  {workspaceStats.activeCount} / {workspaceStats.isUnlimited ? 'Unlimited' : `${workspaceStats.capacity} clients`}
                  {!workspaceStats.isUnlimited && ` (${workspaceStats.utilizationPct}%)`}
                </span>
              </div>
              {!workspaceStats.isUnlimited && (
                <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all duration-300 rounded-full',
                      workspaceStats.isAtCapacity ? 'bg-destructive' : workspaceStats.isWarning ? 'bg-warning' : 'bg-primary'
                    )}
                    style={{ width: `${Math.min(workspaceStats.utilizationPct, 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

{/* Top stats grid */}
      <motion.div
        variants={cardGridVariants}
        initial="initial"
        animate="animate"
        className="ybs-operations-stats mb-8"
      >
        {isAdmin && (
          <>
            <StatCard to="/admin/workspaces?status=active" label="Active Workspaces" value={adminStats.activeWorkspaces} icon={Building2} accent />
            <StatCard to="/admin/applications" label="Pending Approvals" value={adminStats.pendingApprovals} icon={ClipboardCheck} accent={adminStats.pendingApprovals > 0} />
          </>
        )}
        <StatCard to="/clients?status=active" label="Active Clients" value={stats.activeClients} sublabel={`${stats.totalClients || 0} total`} icon={UserCheck} accent={!isAdmin} />
        <StatCard to="/clients?status=expired" label="Expired" value={stats.expiredClients} icon={Users} />
        <StatCard to="/clients?status=expiring_soon" label="Expiring Soon" value={stats.expiringSoon} sublabel="within 7 days" icon={AlertTriangle} />
        {isAdmin && (
          <StatCard to="/team" label="YBS Trainers" value={adminStats.ybsTrainers} icon={UsersRound} />
        )}
        <StatCard to="/forms?checkin=today" label="Today's Check-ins" value={stats.todayCheckins} icon={CalendarCheck} />
        <StatCard to="/forms?status=most_urgent" label="Unreviewed Forms" value={stats.unreviewedForms} icon={FileClock} />
        {canViewFinancials(user) && (
          <StatCard
            onClick={scrollToFinancial}
            label="Total Revenue"
            value={formatCurrency(revenueData?.totalRevenue || 0)}
            icon={DollarSign}
            accent
            ariaLabel="Total Revenue. Open financial overview."
          />
        )}
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        variants={fadeUp}
        initial="initial"
        animate="animate"
        className="surface-card p-5 mb-6"
      >
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="text-[14px] font-display font-semibold">Quick Actions</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {QUICK_ACTIONS.filter((a) => hasPermission(user, a.perm)).map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="group flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] hover:bg-primary/10 border border-white/[0.05] hover:border-primary/25 hover:translate-x-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <a.icon className="w-4 h-4 text-primary" />
              </div>
              <span className="text-[14px] font-medium group-hover:text-primary transition-colors">{a.label}</span>
              <ArrowRight className="ml-auto w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </Link>
          ))}
        </div>
      </motion.div>

      {/* Financial Overview — owner only */}
      {canViewFinancials(user) && revenueData && (
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          id="ybs-financial-overview"
          className="surface-card p-5 mb-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-4 h-4 text-primary" />
            <h3 className="text-[14px] font-display font-semibold">Financial Overview</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[12px] text-muted-foreground uppercase tracking-wider">Total Revenue</p>
              <p className="text-xl font-display font-semibold mt-1 tabular-nums">{formatCurrency(revenueData.totalRevenue)}</p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground uppercase tracking-wider">Active Sub Value</p>
              <p className="text-xl font-display font-semibold mt-1 tabular-nums">{formatCurrency(revenueData.activeSubValue)}</p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground uppercase tracking-wider">Renewals</p>
              <p className="text-xl font-display font-semibold mt-1 tabular-nums">{revenueData.renewals}</p>
            </div>
            <Link
              to="/clients?status=expired"
              className="group rounded-lg -m-1 p-1 hover:bg-primary/5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              aria-label="Expired Subscriptions. Open clients filtered to expired subscriptions."
            >
              <p className="text-[12px] text-muted-foreground uppercase tracking-wider group-hover:text-primary">Expired Subs</p>
              <p className="text-xl font-display font-semibold mt-1 tabular-nums group-hover:text-primary">{revenueData.expired}</p>
            </Link>
          </div>
          {/* Revenue by package */}
          {Object.keys(revenueData.revByPkg).length > 0 && (
            <div className="mt-5 pt-4 border-t border-border">
              <p className="text-[12px] text-muted-foreground uppercase tracking-wider mb-3">Revenue by Package</p>
              <div className="space-y-2">
                {Object.entries(revenueData.revByPkg).map(([pkg, rev]) => {
                  const maxRev = Math.max(...Object.values(revenueData.revByPkg));
                  return (
                    <div key={pkg} className="flex items-center gap-3">
                      <span className="text-[12px] text-muted-foreground w-32 truncate">{pkg}</span>
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(rev / maxRev) * 100}%` }} />
                      </div>
                      <span className="text-[12px] font-medium tabular-nums w-20 text-right">{formatCurrency(rev)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Unreviewed forms */}
      {pendingForms.length > 0 && (
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          className="surface-card p-5 mt-4"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileClock className="w-4 h-4 text-sky-400" />
              <h3 className="text-[14px] font-display font-semibold">Awaiting Review</h3>
            </div>
            <Link to="/assessments" className="text-[12px] text-primary hover:underline">View all</Link>
          </div>
          <div className="space-y-2">
            {pendingForms.map((f) => (
              <Link key={f.id} to="/assessments" className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary/60 hover:translate-x-1 transition-all duration-200">
                <div>
                  <p className="text-[14px] font-medium">{f.name}</p>
                  <p className="text-[12px] text-muted-foreground">{f.assigned_client_name} · Submitted {formatDate(f.submitted_date)}</p>
                </div>
                <Badge className="text-sky-400 bg-sky-500/10 border-sky-500/20">Review</Badge>
              </Link>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
