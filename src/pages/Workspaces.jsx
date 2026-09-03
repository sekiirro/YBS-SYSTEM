import React, { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { WorkspacesService } from '@/services/workspaces';
import { AuditService } from '@/services/audit';
import { useAuth } from '@/lib/AuthContext';
import { PageHeader, StatCard, LoadingState, Badge, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import { Building2, Users, CheckCircle2, AlertTriangle, Plus, Pause, Play, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Workspaces() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState([]);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const ws = await WorkspacesService.list();
      setWorkspaces(ws);
    } catch (err) {
      console.error('Error loading workspaces:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleOpenWorkspace = async (w) => {
    try {
      await AuditService.log({
        actor_id: user?.id,
        actor_name: user?.full_name || user?.email || 'Platform Owner',
        actor_role: 'platform_owner',
        action: 'admin_workspace_access',
        entity_type: 'workspace',
        entity_id: w.id,
        entity_name: w.name,
        workspace_id: w.id,
        metadata: { note: 'Platform Owner opened Workspace administratively' },
      });

      if (user?.id) {
        await supabase.from('profiles').update({ active_workspace_id: w.id }).eq('id', user.id);
      }
    } catch (e) {
      console.warn(e);
    }
    window.location.href = `/workspace/${w.id}/dashboard`;
  };

  const toggleStatus = async (ws) => {
    try {
      await WorkspacesService.toggleStatus(ws.id, ws.status);
      load();
    } catch (err) {
      console.error(err);
    }
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
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Create Workspace
          </Button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard title="Total Workspaces" value={workspaces.length} icon={Building2} />
        <StatCard title="Active Workspaces" value={active} icon={CheckCircle2} change="Operating normally" positive />
        <StatCard title="Total Clients" value={totalClients} icon={Users} />
      </div>

      {/* Workspace list */}
      <div className="surface-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-display font-semibold text-foreground">All Customer Workspaces</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Each brand operates in full multi-tenant isolation.
            </p>
          </div>
          <Badge variant="outline">{workspaces.length} total</Badge>
        </div>

        {workspaces.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-[13px]">
            No workspaces have been created yet. Click "Create Workspace" above.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {workspaces.map((w) => (
              <div
                key={w.id}
                className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-secondary/30 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-medium text-foreground">{w.name}</span>
                    <Badge variant={w.status === 'active' ? 'success' : 'destructive'} className="capitalize">
                      {w.status}
                    </Badge>
                    {w.platform_plan && (
                      <Badge variant="outline" className="capitalize text-[11px]">
                        {w.platform_plan}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                    <span>Owner: {w.owner_name || w.owner_email || '—'}</span>
                    {w.owner_phone && <span>Phone: {w.owner_phone}</span>}
                    <span>Created: {formatDate(w.created_at || w.created_date)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={() => handleOpenWorkspace(w)}>
                    <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open Workspace
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleStatus(w)}
                    title={w.status === 'active' ? 'Suspend workspace' : 'Activate workspace'}
                  >
                    {w.status === 'active' ? (
                      <>
                        <Pause className="w-3.5 h-3.5 mr-1 text-warning" /> Suspend
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 mr-1 text-success" /> Activate
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateWorkspaceModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    platform_plan: 'starter',
    status: 'active',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!form.name.trim() || !form.owner_email.trim()) {
      setError('Workspace name and owner email are required');
      return;
    }
    setSaving(true);

    try {
      // 1. Create workspace
      const ws = await WorkspacesService.create({
        name: form.name.trim(),
        owner_name: form.owner_name.trim() || null,
        owner_email: form.owner_email.trim().toLowerCase(),
        owner_phone: form.owner_phone.trim() || null,
        status: form.status,
        platform_plan: form.platform_plan,
        client_count: 0,
        settings: { default_follow_up_day: 'saturday', timezone: 'Africa/Cairo', currency: 'EGP', notes: form.notes },
      });

      // 2. Check if a profile exists with this email
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', form.owner_email.trim().toLowerCase())
        .maybeSingle();

      if (existingProfile?.id) {
        await supabase.from('workspace_memberships').insert({
          workspace_id: ws.id,
          user_id: existingProfile.id,
          workspace_role: 'workspace_owner',
          status: 'active',
        });
      }

      setSuccess(`Workspace "${form.name}" created successfully.`);
      setTimeout(onCreated, 1000);
    } catch (err) {
      setError(err.message || 'Failed to create workspace');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Create Workspace" size="lg">
      {error && (
        <div className="mb-3 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-3 p-3 rounded-md bg-success/10 border border-success/20 text-success text-[13px]">
          {success}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 rounded-md bg-primary/5 border border-primary/15 text-[12px] text-muted-foreground">
          Workspaces are created by the platform owner. The brand owner signs in to access their isolated coaching portal.
        </div>
        <Input label="Workspace / Brand Name *" value={form.name} onChange={set('name')} placeholder="S Fitness" required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Owner Name" value={form.owner_name} onChange={set('owner_name')} placeholder="Coach Sam" />
          <Input label="Owner Phone" value={form.owner_phone} onChange={set('owner_phone')} placeholder="+20 10x xxx xxxx" />
        </div>
        <Input label="Owner Email *" type="email" value={form.owner_email} onChange={set('owner_email')} placeholder="owner@brand.com" required />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Platform Plan" value={form.platform_plan} onChange={set('platform_plan')}>
            {['starter', 'growth', 'scale', 'enterprise', 'trial', 'custom'].map((p) => (
              <option key={p} value={p} className="capitalize">
                {p}
              </option>
            ))}
          </Select>
          <Select label="Status" value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </Select>
        </div>
        <TextArea label="Notes (internal)" rows={2} value={form.notes} onChange={set('notes')} placeholder="Internal account notes…" />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              'Create Workspace'
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}