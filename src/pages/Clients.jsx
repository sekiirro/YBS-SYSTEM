const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Input, Select, Modal } from '@/components/ui';
import { formatDate, getSubscriptionStatusColor, generateClientCode, getInitials } from '@/lib/ybs-utils';
import { Users, Search, Plus, Filter, Phone, Mail, Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Clients() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [trainerFilter, setTrainerFilter] = useState('all');
  const [packageFilter, setPackageFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  const isTrainer = user?.role === 'trainer';

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const filter = isTrainer ? { assigned_trainer_id: user.id } : {};
      const [clientData, userData, pkgData] = await Promise.all([
        db.entities.Client.filter(filter, '-created_date', 500),
        db.entities.User.list(),
        db.entities.Package.filter({ is_active: true }),
      ]);
      setClients(clientData);
      setTrainers(userData.filter((u) => u.role === 'trainer' && u.status !== 'disabled'));
      setPackages(pkgData);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (search) {
        const q = search.toLowerCase();
        if (!c.full_name?.toLowerCase().includes(q) &&
            !c.client_code?.toLowerCase().includes(q) &&
            !c.phone?.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== 'all' && c.subscription_status !== statusFilter) return false;
      if (trainerFilter !== 'all' && c.assigned_trainer_id !== trainerFilter) return false;
      if (packageFilter !== 'all' && c.package_id !== packageFilter) return false;
      return true;
    });
  }, [clients, search, statusFilter, trainerFilter, packageFilter]);

  const hasActiveFilters = search || statusFilter !== 'all' || trainerFilter !== 'all' || packageFilter !== 'all';

  if (loading) return <LoadingState label="Loading clients…" />;

  return (
    <div>
      <PageHeader
        title="Clients"
        description={isTrainer ? 'Your assigned client portfolio' : 'All organization clients'}
        actions={
          hasPermission(user, 'clients.create') && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> Add Client
            </Button>
          )
        }
        icon={Users}
      />

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
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="expiring_soon">Expiring Soon</option>
              <option value="expired">Expired</option>
              <option value="frozen">Frozen</option>
              <option value="no_subscription">No Subscription</option>
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
              <Button variant="ghost" size="icon" onClick={() => { setSearch(''); setStatusFilter('all'); setTrainerFilter('all'); setPackageFilter('all'); }}>
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

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasActiveFilters ? 'No matching clients' : 'No clients yet'}
          description={hasActiveFilters ? 'Try adjusting your filters' : 'Add your first client to get started'}
        />
      ) : (
        <div className="surface-card overflow-hidden">
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Client</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Code</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Phone</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Package</th>
                  {!isTrainer && <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Trainer</th>}
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sub End</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer group" onClick={() => window.location.href = `/clients/${c.id}`}>
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
                    <td className="px-4 py-3"><span className="text-[12px] font-mono text-muted-foreground">{c.client_code}</span></td>
                    <td className="px-4 py-3"><span className="text-[12px] text-muted-foreground">{c.phone || '—'}</span></td>
                    <td className="px-4 py-3"><span className="text-[12px] text-muted-foreground">{c.package_name || '—'}</span></td>
                    {!isTrainer && <td className="px-4 py-3"><span className="text-[12px] text-muted-foreground">{c.assigned_trainer_name || '—'}</span></td>}
                    <td className="px-4 py-3"><span className="text-[12px] text-muted-foreground">{formatDate(c.subscription_end_date)}</span></td>
                    <td className="px-4 py-3">
                      <Badge className={cn(getSubscriptionStatusColor(c.subscription_status), 'capitalize')}>
                        {c.subscription_status?.replace('_', ' ') || 'none'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-border">
            {filtered.map((c) => (
              <Link key={c.id} to={`/clients/${c.id}`} className="block p-4 hover:bg-secondary/30 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                      {getInitials(c.full_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium truncate">{c.full_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{c.client_code} · {c.phone || 'No phone'}</p>
                    </div>
                  </div>
                  <Badge className={cn(getSubscriptionStatusColor(c.subscription_status), 'shrink-0 capitalize')}>
                    {c.subscription_status?.replace('_', ' ') || 'none'}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 mt-2.5 text-[11px] text-muted-foreground">
                  <span>{c.package_name || 'No package'}</span>
                  <span>·</span>
                  <span>Ends {formatDate(c.subscription_end_date)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateClientModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadData(); }}
          trainers={trainers}
          packages={packages}
          existingCodes={clients.map((c) => c.client_code)}
          user={user}
        />
      )}
    </div>
  );
}

function CreateClientModal({ onClose, onCreated, trainers, packages, existingCodes, user }) {
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    date_of_birth: '',
    gender: 'male',
    height: '',
    current_weight: '',
    assigned_trainer_id: user?.role === 'trainer' ? user.id : '',
    package_id: '',
    follow_up_day: 'saturday',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.full_name || !form.phone) {
      setError('Name and phone are required');
      return;
    }
    try {
      setSaving(true);
      const clientCode = generateClientCode(existingCodes);
      const trainer = trainers.find((t) => t.id === form.assigned_trainer_id);
      const pkg = packages.find((p) => p.id === form.package_id);

      await db.entities.Client.create({
        ...form,
        client_code: clientCode,
        assigned_trainer_name: trainer?.full_name || trainer?.email || '',
        package_name: pkg?.name || '',
        join_date: new Date().toISOString().split('T')[0],
        subscription_status: pkg ? 'active' : 'no_subscription',
      });

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
        {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[13px] text-red-400">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Full Name *" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="John Doe" />
          <Input label="Phone *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1234567890" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="john@example.com" />
          <Input label="Date of Birth" type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
          <Select label="Follow-up Day" value={form.follow_up_day} onChange={(e) => setForm({ ...form, follow_up_day: e.target.value })}>
            {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d) => (
              <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Height (cm)" type="number" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
          <Input label="Current Weight (kg)" type="number" value={form.current_weight} onChange={(e) => setForm({ ...form, current_weight: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {user?.role !== 'trainer' && (
            <Select label="Assigned Trainer" value={form.assigned_trainer_id} onChange={(e) => setForm({ ...form, assigned_trainer_id: e.target.value })}>
              <option value="">Select trainer…</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
              ))}
            </Select>
          )}
          <Select label="Package" value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}>
            <option value="">No package</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </div>
        <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes…" />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Client'}</Button>
        </div>
      </form>
    </Modal>
  );
}