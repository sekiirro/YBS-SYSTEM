const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { PageHeader, StatCard, LoadingState, Badge, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import { Building2, Users, CheckCircle2, AlertTriangle, Plus, Pause, Play, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Workspaces() {
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState([]);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const ws = await db.entities.Workspace.list('-created_date', 200);
      setWorkspaces(ws);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const toggleStatus = async (ws) => {
    const next = ws.status === 'active' ? 'suspended' : 'active';
    try { await db.entities.Workspace.update(ws.id, { status: next }); load(); } catch (err) { console.error(err); }
  };

  if (loading) return <LoadingState label="Loading workspaces…" />;

  const active = workspaces.filter((w) => w.status === 'active').length;
  const totalClients = workspaces.reduce((s, w) => s + (w.client_count || 0), 0);

  return (
    <div>
      <PageHeader
        title="Workspaces"
        description="Customer coaching workspaces — created and managed by the platform owner"
        icon={Building2}
        actions={<Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> Create Workspace</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Workspaces" value={workspaces.length} icon={Building2} accent />
        <StatCard label="Active" value={active} icon={CheckCircle2} />
        <StatCard label="Suspended" value={workspaces.filter((w) => w.status === 'suspended').length} icon={AlertTriangle} />
        <StatCard label="Total Clients" value={totalClients} icon={Users} />
      </div>

      <div className="surface-card overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Workspace', 'Owner', 'Clients', 'Plan', 'Status', 'Created', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center text-primary text-[11px] font-semibold">{w.name?.[0]}</div>
                      <span className="text-[13px] font-medium">{w.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{w.owner_name || '—'}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground tabular-nums">{w.client_count || 0}</td>
                  <td className="px-4 py-3"><span className="text-[12px] text-muted-foreground capitalize">{w.platform_plan}</span></td>
                  <td className="px-4 py-3">
                    <Badge className={cn(w.status === 'active' ? 'text-success bg-success/10 border-success/20' : 'text-destructive bg-destructive/10 border-destructive/20', 'capitalize')}>{w.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(w.created_date)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => window.location.href = `/workspace/${w.id}/dashboard`} title="Open"><ExternalLink className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleStatus(w)} title={w.status === 'active' ? 'Suspend' : 'Activate'}>
                        {w.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lg:hidden divide-y divide-border">
          {workspaces.map((w) => (
            <div key={w.id} className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-medium">{w.name}</span>
                <Badge className={cn(w.status === 'active' ? 'text-success bg-success/10 border-success/20' : 'text-destructive bg-destructive/10 border-destructive/20', 'capitalize')}>{w.status}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{w.owner_name} · {w.client_count || 0} clients · {w.platform_plan}</p>
            </div>
          ))}
        </div>
      </div>

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function CreateWorkspaceModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', owner_name: '', owner_phone: '', owner_email: '',
    platform_plan: 'starter', status: 'active', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!form.name || !form.owner_name || !form.owner_email) { setError('Workspace name, owner name, and owner email are required'); return; }
    setSaving(true);
    try {
      // 1. Create the workspace.
      const ws = await db.entities.Workspace.create({
        name: form.name,
        owner_name: form.owner_name,
        owner_phone: form.owner_phone,
        owner_email: form.owner_email,
        status: form.status,
        platform_plan: form.platform_plan,
        client_count: 0,
        assigned_ybs_coaches: [],
        settings: { default_follow_up_day: 'saturday', timezone: 'Africa/Cairo', currency: 'EGP' },
      });

      // 2. Provision the brand owner account via secure invitation.
      let invited = false;
      try {
        await db.users.inviteUser(form.owner_email, 'user');
        // Configure the invited user's workspace context + role.
        const users = await db.entities.User.list('-created_date', 500);
        const owner = users.find((u) => u.email === form.owner_email);
        if (owner) {
          await db.entities.User.update(owner.id, {
            platform_role: 'none',
            account_status: 'active',
            workspace_ids: [ws.id],
            managed_workspace_ids: [ws.id],
            active_workspace_id: ws.id,
            phone: form.owner_phone,
          });
        }
        invited = true;
      } catch (inviteErr) {
        // Invite may fail if user already exists — still create the workspace.
        console.error('invite failed', inviteErr.message);
      }

      setSuccess(`Workspace "${ws.name}" created.${invited ? ' An invitation email was sent to the owner to set their password.' : ' Owner account provisioning pending — the email may already be registered.'}`);
      setTimeout(onCreated, 1800);
    } catch (err) {
      setError(err.message || 'Failed to create workspace');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Create Workspace" size="lg">
      {error && <div className="mb-3 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">{error}</div>}
      {success && <div className="mb-3 p-3 rounded-md bg-success/10 border border-success/20 text-success text-[13px]">{success}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 rounded-md bg-primary/5 border border-primary/15 text-[12px] text-muted-foreground">
          Workspaces are created by the platform owner. The brand owner receives an invitation to set their own password — no plaintext passwords are stored.
        </div>
        <Input label="Workspace / Brand Name *" value={form.name} onChange={set('name')} placeholder="S Fitness" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Owner Name *" value={form.owner_name} onChange={set('owner_name')} placeholder="Trainer S" />
          <Input label="Owner Phone" value={form.owner_phone} onChange={set('owner_phone')} placeholder="+20 10x xxx xxxx" />
        </div>
        <Input label="Owner Email *" value={form.owner_email} onChange={set('owner_email')} placeholder="owner@brand.com" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Platform Plan" value={form.platform_plan} onChange={set('platform_plan')}>
            {['starter', 'growth', 'scale', 'enterprise', 'trial', 'custom'].map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
          </Select>
          <Select label="Status" value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </Select>
        </div>
        <TextArea label="Notes (internal)" rows={2} value={form.notes} onChange={set('notes')} placeholder="Internal account notes…" />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : 'Create Workspace'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}