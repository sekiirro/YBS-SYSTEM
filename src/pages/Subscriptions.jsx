const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { hasPermission, canViewFinancials } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Badge, Button } from '@/components/ui';
import { formatDate, formatCurrency, getSubscriptionStatusColor } from '@/lib/ybs-utils';
import { CreditCard, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Subscriptions() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const isTrainer = user?.role === 'trainer';

  useEffect(() => { loadSubs(); }, []);

  const loadSubs = async () => {
    try {
      setLoading(true);
      const data = await db.entities.Subscription.list('-start_date', 300);
      setSubs(data);
    } finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    return subs.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        if (!s.client_name?.toLowerCase().includes(q) && !s.client_code?.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      return true;
    });
  }, [subs, search, statusFilter]);

  if (loading) return <LoadingState label="Loading subscriptions…" />;

  return (
    <div>
      <PageHeader title="Subscriptions" description="Subscription history and status" icon={CreditCard} />
      <div className="surface-card p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Search by client name or code…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40">
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="expiring_soon">Expiring Soon</option>
            <option value="expired">Expired</option>
            <option value="renewed">Renewed</option>
            <option value="frozen">Frozen</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={CreditCard} title="No subscriptions found" description="Try adjusting your filters" />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Client</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Package</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Start</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">End</th>
                  {canViewFinancials(user) && <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Price</th>}
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Payment</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium">{s.client_name || '—'}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{s.client_code || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{s.package_name || '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(s.start_date)}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(s.end_date)}</td>
                    {canViewFinancials(user) && <td className="px-4 py-3 text-[12px] tabular-nums">{formatCurrency(s.price)}</td>}
                    <td className="px-4 py-3">
                      {canViewFinancials(user) ? (
                        <Badge className={cn(
                          s.payment_status === 'paid' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                          s.payment_status === 'partially_paid' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                          'text-red-400 bg-red-500/10 border-red-500/20', 'capitalize'
                        )}>{s.payment_status?.replace('_', ' ')}</Badge>
                      ) : <span className="text-[12px] text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={cn(getSubscriptionStatusColor(s.status), 'capitalize')}>{s.status.replace('_', ' ')}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lg:hidden divide-y divide-border">
            {filtered.map((s) => (
              <div key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium">{s.client_name}</p>
                    <p className="text-[11px] text-muted-foreground">{s.package_name} · {formatDate(s.start_date)} → {formatDate(s.end_date)}</p>
                  </div>
                  <Badge className={cn(getSubscriptionStatusColor(s.status), 'capitalize shrink-0')}>{s.status.replace('_', ' ')}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}