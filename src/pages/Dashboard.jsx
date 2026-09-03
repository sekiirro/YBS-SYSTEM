const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { hasPermission, canViewFinancials } from '@/lib/permissions';
import { PageHeader, StatCard, LoadingState, Badge, Button } from '@/components/ui';
import { formatDate, formatCurrency, getSubscriptionStatusColor, daysUntil } from '@/lib/ybs-utils';
import {
  Users, UserCheck, AlertTriangle, CalendarCheck, FileText, FileWarning,
  FileClock, DollarSign, TrendingUp, Activity, ArrowRight, CreditCard
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

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const isTrainer = user?.role === 'trainer';
      const clientFilter = isTrainer ? { assigned_trainer_id: user.id } : {};

      const [clients, forms, subscriptions, timeline, packages] = await Promise.all([
        db.entities.Client.filter(clientFilter, '-created_date', 200),
        db.entities.Assessment.filter(
          isTrainer ? { trainer_id: user.id, is_template: false } : { is_template: false },
          '-created_date', 100
        ),
        db.entities.Subscription.filter({}, '-created_date', 200),
        db.entities.TimelineEvent.list('-created_date', 10),
        db.entities.Package.filter({ is_active: true }),
      ]);

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
        title="Dashboard"
        description={user?.role === 'trainer' ? 'Your assigned client portfolio overview' : 'Organization overview and key metrics'}
      />

      {/* Top stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4 mb-6">
        <StatCard label="Active Clients" value={stats.activeClients} sublabel={`${stats.totalClients || 0} total`} icon={UserCheck} accent />
        <StatCard label="Expired" value={stats.expiredClients} icon={Users} />
        <StatCard label="Expiring Soon" value={stats.expiringSoon} sublabel="within 7 days" icon={AlertTriangle} />
        <StatCard label="Today's Check-ins" value={stats.todayCheckins} icon={CalendarCheck} />
        <StatCard label="Pending Forms" value={stats.pendingForms} icon={FileText} />
        <StatCard label="Overdue Forms" value={stats.overdueForms} icon={FileWarning} />
        <StatCard label="Unreviewed" value={stats.unreviewedForms} icon={FileClock} />
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