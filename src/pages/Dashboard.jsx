import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/utils/supabase';
import { ClientsService } from '@/services/clients';
import { AssessmentsService } from '@/services/assessments';
import { SubscriptionsService } from '@/services/subscriptions';
import { PackagesService } from '@/services/packages';
import { WorkspacesService } from '@/services/workspaces';
import { AuditService } from '@/services/audit';
import { hasPermission, canViewFinancials, isPlatformAdmin } from '@/lib/permissions';
import { PageHeader, StatCard, LoadingState, Badge, Button } from '@/components/ui';
import { formatDate, formatCurrency, getSubscriptionStatusColor, daysUntil } from '@/lib/ybs-utils';
import {
  Users, UserCheck, AlertTriangle, CalendarCheck, FileText, FileWarning,
  FileClock, DollarSign, TrendingUp, Activity, ArrowRight, CreditCard,
  Building2, ClipboardCheck, UsersRound, AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({});
  const [recentActivity, setRecentActivity] = useState([]);
  const [expiringClients, setExpiringClients] = useState([]);
  const [pendingForms, setPendingForms] = useState([]);
  const [revenueData, setRevenueData] = useState(null);
  const [adminStats, setAdminStats] = useState({ activeWorkspaces: 0, pendingApprovals: 0, ybsTrainers: 0 });

  const isAdmin = isPlatformAdmin(user);

  useEffect(() => {
    loadDashboard();
  }, [user]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const isTrainer = user?.role === 'trainer' || user?.platform_role === 'platform_trainer';
      const clientFilter = isTrainer ? { assigned_ybs_coach_id: user.id } : {};

      const promises = [
        ClientsService.list(clientFilter),
        AssessmentsService.list(isTrainer ? { assigned_ybs_coach_id: user.id } : {}),
        SubscriptionsService.list(),
        AuditService.list(),
        PackagesService.list(),
      ];

      if (isAdmin) {
        promises.push(WorkspacesService.list().catch(() => []));
        promises.push(supabase.from('client_applications').select('*').eq('status', 'pending').then((r) => r.data || []));
        promises.push(supabase.from('profiles').select('*').eq('platform_role', 'platform_trainer').then((r) => r.data || []));
      }

      const results = await Promise.all(promises);
      const clients = results[0] || [];
      const forms = results[1] || [];
      const subscriptions = results[2] || [];
      const timeline = results[3] || [];
      const packages = results[4] || [];

      if (isAdmin) {
        const wsList = results[5] || [];
        const pendingApps = results[6] || [];
        const allUsers = results[7] || [];
        const trainerUsers = allUsers.filter(u => u.platform_role === 'platform_trainer' || u.ybs_coach === true);
        setAdminStats({
          activeWorkspaces: wsList.filter(w => w.status === 'active').length,
          pendingApprovals: pendingApps.length,
          ybsTrainers: trainerUsers.length,
        });
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
      const dayName = new Date().toLocaleDateString('en-US', { weekday: 'lowercase' });
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

      setExpiringClients(expiringSoon.slice(0, 5));
      setPendingForms(unreviewed.slice(0, 5));
      setRecentActivity(timeline);

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
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">{adminStats.pendingApprovals} Client Application{adminStats.pendingApprovals > 1 ? 's' : ''} Awaiting Review</p>
              <p className="text-xs text-muted-foreground">New clients have self-registered and require workspace assignment and trainer allocation.</p>
            </div>
          </div>
          <Link to="/admin/applications">
            <Button size="sm" className="shrink-0 bg-amber-500 hover:bg-amber-600 text-black font-medium">Review Approvals</Button>
          </Link>
        </div>
      )}

      {/* Top stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4 mb-6">
        {isAdmin && (
          <>
            <StatCard label="Active Workspaces" value={adminStats.activeWorkspaces} icon={Building2} accent />
            <StatCard label="Pending Approvals" value={adminStats.pendingApprovals} icon={ClipboardCheck} accent={adminStats.pendingApprovals > 0} />
          </>
        )}
        <StatCard label="Active Clients" value={stats.activeClients} sublabel={`${stats.totalClients || 0} total`} icon={UserCheck} accent={!isAdmin} />
        <StatCard label="Expired" value={stats.expiredClients} icon={Users} />
        <StatCard label="Expiring Soon" value={stats.expiringSoon} sublabel="within 7 days" icon={AlertTriangle} />
        {isAdmin && (
          <StatCard label="YBS Trainers" value={adminStats.ybsTrainers} icon={UsersRound} />
        )}
        <StatCard label="Today's Check-ins" value={stats.todayCheckins} icon={CalendarCheck} />
        <StatCard label="Unreviewed Forms" value={stats.unreviewedForms} icon={FileClock} />
        {canViewFinancials(user) && (
          <StatCard label="Total Revenue" value={formatCurrency(revenueData?.totalRevenue || 0)} icon={DollarSign} accent />
        )}
      </div>

      {/* Financial section — owner only */}
      {canViewFinancials(user) && revenueData && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="surface-card p-5 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-4 h-4 text-primary" />
              <h3 className="text-[14px] font-display font-semibold">Financial Overview</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Total Revenue</p>
                <p className="text-xl font-display font-semibold mt-1 tabular-nums">{formatCurrency(revenueData.totalRevenue)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Active Sub Value</p>
                <p className="text-xl font-display font-semibold mt-1 tabular-nums">{formatCurrency(revenueData.activeSubValue)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Renewals</p>
                <p className="text-xl font-display font-semibold mt-1 tabular-nums">{revenueData.renewals}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Expired Subs</p>
                <p className="text-xl font-display font-semibold mt-1 tabular-nums">{revenueData.expired}</p>
              </div>
            </div>
            {/* Revenue by package */}
            {Object.keys(revenueData.revByPkg).length > 0 && (
              <div className="mt-5 pt-4 border-t border-border">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-3">Revenue by Package</p>
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
          </div>
          <div className="surface-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-primary" />
              <h3 className="text-[14px] font-display font-semibold">Quick Actions</h3>
            </div>
            <div className="space-y-2">
              <Link to="/clients" className="flex items-center justify-between p-3 rounded-lg bg-secondary/40 hover:bg-secondary/70 transition-colors group">
                <span className="text-[13px] font-medium">View Clients</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </Link>
              <Link to="/subscriptions" className="flex items-center justify-between p-3 rounded-lg bg-secondary/40 hover:bg-secondary/70 transition-colors group">
                <span className="text-[13px] font-medium">Manage Subscriptions</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </Link>
              <Link to="/assessments" className="flex items-center justify-between p-3 rounded-lg bg-secondary/40 hover:bg-secondary/70 transition-colors group">
                <span className="text-[13px] font-medium">Review Forms</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </Link>
              <Link to="/team" className="flex items-center justify-between p-3 rounded-lg bg-secondary/40 hover:bg-secondary/70 transition-colors group">
                <span className="text-[13px] font-medium">Team Management</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Two column: expiring + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Expiring soon */}
        <div className="surface-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <h3 className="text-[14px] font-display font-semibold">Expiring Soon</h3>
            </div>
            <Link to="/clients" className="text-[12px] text-primary hover:underline">View all</Link>
          </div>
          {expiringClients.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-6 text-center">No subscriptions expiring soon</p>
          ) : (
            <div className="space-y-2">
              {expiringClients.map((c) => {
                const days = daysUntil(c.subscription_end_date);
                return (
                  <Link key={c.id} to={`/clients/${c.id}`} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary/60 transition-colors">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">{c.full_name}</p>
                      <p className="text-[11px] text-muted-foreground">{c.client_code} · {c.package_name || 'No package'}</p>
                    </div>
                    <Badge className={cn(getSubscriptionStatusColor(c.subscription_status), 'shrink-0')}>
                      {days} days left
                    </Badge>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="text-[14px] font-display font-semibold">Recent Activity</h3>
          </div>
          {recentActivity.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-6 text-center">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((event) => (
                <div key={event.id} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{event.title}</p>
                    <p className="text-[11px] text-muted-foreground">{event.client_name} · {formatDate(event.created_date, 'MMM d, h:mm a')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Unreviewed forms */}
      {pendingForms.length > 0 && (
        <div className="surface-card p-5 mt-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileClock className="w-4 h-4 text-sky-400" />
              <h3 className="text-[14px] font-display font-semibold">Awaiting Review</h3>
            </div>
            <Link to="/assessments" className="text-[12px] text-primary hover:underline">View all</Link>
          </div>
          <div className="space-y-2">
            {pendingForms.map((f) => (
              <Link key={f.id} to="/assessments" className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary/60 transition-colors">
                <div>
                  <p className="text-[13px] font-medium">{f.name}</p>
                  <p className="text-[11px] text-muted-foreground">{f.assigned_client_name} · Submitted {formatDate(f.submitted_date)}</p>
                </div>
                <Badge className="text-sky-400 bg-sky-500/10 border-sky-500/20">Review</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}