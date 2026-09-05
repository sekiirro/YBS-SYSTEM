import React, { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { WorkspacesService } from '@/services/workspaces';
import { PartnershipTypesService } from '@/services/partnershipTypes';
import { AuditService } from '@/services/audit';
import { useAuth } from '@/lib/AuthContext';
import { getAppBaseUrl } from '@/lib/app-params';
import { toast } from '@/components/ui/use-toast';
import { PageHeader, StatCard, LoadingState, Badge, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import {
  Building2, Users, CheckCircle2, AlertTriangle, Plus, Pause, Play,
  ExternalLink, Loader2, Globe, DollarSign, Copy, Check, ShieldAlert, Link2, Mail
} from 'lucide-react';
import { cn } from '@/lib/utils';

function RegistrationLinkRow({ token, label = 'Trainee Registration Link' }) {
  const [copied, setCopied] = useState(false);
  if (!token) return null;
  const joinUrl = `${window.location.origin}/join/${token}`;
  const handleCopy = () => {
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div className="surface-card p-3 border border-border space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-foreground flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-muted-foreground" /> {label}
        </span>
        <span className="text-[11px] text-muted-foreground">Share this link so trainees can register directly</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={joinUrl}
          className="flex-1 h-9 px-3 rounded-md bg-secondary/50 border border-border text-[12px] font-mono text-muted-foreground select-all"
        />
        <Button variant="secondary" size="sm" onClick={handleCopy}>
          {copied ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
          {copied ? 'Copied' : 'Copy Link'}
        </Button>
      </div>
    </div>
  );
}

export default function Workspaces() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState([]);
  const [partnershipTypes, setPartnershipTypes] = useState([]);
  const [partnershipTypesLoading, setPartnershipTypesLoading] = useState(false);
  const [partnershipTypesError, setPartnershipTypesError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [sendingInviteId, setSendingInviteId] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      setPartnershipTypesLoading(true);
      setPartnershipTypesError('');
      const ws = await WorkspacesService.list();
      setWorkspaces(ws);
    } catch (err) {
      console.error('Error loading workspaces:', err);
    } finally {
      setLoading(false);
    }

    try {
      const pts = await PartnershipTypesService.list();
      setPartnershipTypes(pts || []);
    } catch (err) {
      console.error('Error loading partnership types:', err);
      setPartnershipTypesError('Partnership Types could not be loaded.');
    } finally {
      setPartnershipTypesLoading(false);
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

  const resendInvite = async (ws) => {
    const email = ws.owner_email;
    if (!email) return;
    try {
      setSendingInviteId(ws.id);
      const activationUrl = `${getAppBaseUrl()}/activate?email=${encodeURIComponent(email)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: activationUrl,
          data: {
            full_name: ws.owner_name || email,
            role: 'workspace_owner',
          },
        },
      });
      if (error) throw error;
      toast({
        title: 'Invitation sent',
        description: `Activation email sent to ${email}.`,
      });
    } catch (err) {
      toast({
        title: 'Invitation failed',
        description: err.message || 'Could not send the invitation email.',
        variant: 'destructive',
      });
    } finally {
      setSendingInviteId(null);
    }
  };

  if (loading) return <LoadingState label="Loading workspaces…" />;

  const activeWorkspaces = workspaces.filter((w) => w.status === 'active').length;
  const totalActiveClients = workspaces.reduce((s, w) => s + Number(w.active_clients_count || w.client_count || 0), 0);
  const nearCapacityWorkspaces = workspaces.filter((w) => {
    const cap = w.client_capacity;
    if (!cap) return false;
    const act = Number(w.active_clients_count || 0);
    return (act / cap) >= 0.9;
  }).length;

  return (
    <div>
      <PageHeader
        title="Workspaces"
        description="Multi-tenant brand coaching workspaces — created and managed by the platform owner"
        icon={Building2}
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Create Workspace
          </Button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Workspaces" value={workspaces.length} icon={Building2} />
        <StatCard label="Active Workspaces" value={activeWorkspaces} icon={CheckCircle2} sublabel="Operating normally" />
        <StatCard label="Total Active Clients" value={totalActiveClients} icon={Users} />
        <StatCard
          label="Capacity Alerts"
          value={nearCapacityWorkspaces}
          icon={AlertTriangle}
          sublabel={nearCapacityWorkspaces > 0 ? "Workspaces >= 90% capacity" : "All within capacity"}
          accent={nearCapacityWorkspaces > 0}
        />
      </div>


      {/* Workspace list */}
      <div className="surface-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-display font-semibold text-foreground">All Customer Workspaces</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Strict multi-tenant isolation, partnership tiers, and client capacity limits.
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
            {workspaces.map((w) => {
              const activeClients = Number(w.active_clients_count ?? w.client_count ?? 0);
              const capacity = w.client_capacity;
              const isUnlimited = capacity === null || capacity === undefined;
              const utilizationPct = !isUnlimited && capacity > 0
                ? Math.round((activeClients / capacity) * 100)
                : 0;
              const isWarning = !isUnlimited && utilizationPct >= 90 && utilizationPct < 100;
              const isAtCapacity = !isUnlimited && activeClients >= capacity;
              const pTypeName = w.partnership_type_name || w.partnership_types?.name || w.platform_plan;
              const trainersCount = Number(w.assigned_trainers_count ?? 0);

              return (
                <div
                  key={w.id}
                  className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-secondary/30 transition-colors"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[16px] font-semibold text-foreground">{w.name}</span>
                      <Badge variant={w.status === 'active' ? 'success' : 'destructive'} className="capitalize">
                        {w.status}
                      </Badge>
                      {pTypeName && (
                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[11px] font-medium">
                          {pTypeName}
                        </Badge>
                      )}
                      {w.timezone && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded border border-border">
                          <Globe className="w-3 h-3" /> {w.timezone}
                        </span>
                      )}
                      {w.currency && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded border border-border">
                          <DollarSign className="w-3 h-3" /> {w.currency}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
                      <span>Owner: <strong className="text-foreground font-medium">{w.owner_name || w.owner_email || '—'}</strong> ({w.owner_email})</span>
                      {w.owner_phone && <span>Phone: {w.owner_phone}</span>}
                      <span>Created: {formatDate(w.created_at)}</span>
                      <span>Assigned Trainers: <strong className="text-foreground font-medium">{trainersCount}</strong></span>
                    </div>

                    {/* Capacity Indicator */}
                    <div className="pt-1 max-w-md">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-muted-foreground">
                          Active Clients: <strong className="text-foreground">{activeClients}</strong> / {isUnlimited ? 'Unlimited' : capacity}
                        </span>
                        {isAtCapacity ? (
                          <span className="text-destructive font-semibold flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" /> 100% (Capacity Reached)
                          </span>
                        ) : isWarning ? (
                          <span className="text-warning font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> {utilizationPct}% (Approaching Limit)
                          </span>
                        ) : !isUnlimited ? (
                          <span className="text-muted-foreground">{utilizationPct}% utilized</span>
                        ) : (
                          <span className="text-emerald-500 font-medium">Unlimited Capacity</span>
                        )}
                      </div>
                      {!isUnlimited && (
                        <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className={cn(
                              'h-full transition-all duration-300 rounded-full',
                              isAtCapacity ? 'bg-destructive' : isWarning ? 'bg-warning' : 'bg-primary'
                            )}
                            style={{ width: `${Math.min(utilizationPct, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Persistent trainee registration link */}
                    <div className="pt-1 max-w-md">
                      <a
                        href={`${window.location.origin}/join/${w.public_join_token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline truncate max-w-full"
                        title="Open trainee registration page"
                      >
                        <Link2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {window.location.origin}/join/{w.public_join_token}
                        </span>
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="secondary" size="sm" onClick={() => handleOpenWorkspace(w)}>
                      <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open Workspace
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resendInvite(w)}
                      disabled={sendingInviteId === w.id}
                      title={w.owner_email ? `Resend activation invite to ${w.owner_email}` : 'Resend activation invite'}
                    >
                      {sendingInviteId === w.id ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      ) : (
                        <Mail className="w-3.5 h-3.5 mr-1 text-primary" />
                      )}
                      {sendingInviteId === w.id ? 'Sending…' : 'Resend Invitation'}
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
              );
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateWorkspaceModal
          partnershipTypes={partnershipTypes}
          partnershipTypesLoading={partnershipTypesLoading}
          partnershipTypesError={partnershipTypesError}
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

function CreateWorkspaceModal({
  partnershipTypes = [],
  partnershipTypesLoading = false,
  partnershipTypesError = '',
  onClose,
  onCreated,
}) {
  const [form, setForm] = useState({
    name: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    partnership_type_id: '',
    is_unlimited: true,
    client_capacity: 50,
    timezone: 'Africa/Cairo',
    currency: 'EGP',
    status: 'active',
    notes: '',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [provisionResult, setProvisionResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleCopyLink = (link) => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const email = form.owner_email.trim().toLowerCase();
    if (!form.name.trim() || !email) {
      setError('Workspace name and owner email are required');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid owner email address');
      return;
    }

    if (!form.partnership_type_id) {
      setError('Please select a Partnership Type');
      return;
    }

    if (partnershipTypesError) {
      setError('Partnership Types could not be loaded. Please try again.');
      return;
    }

    setSaving(true);

    try {
      const selectedPt = partnershipTypes.find((p) => p.id === form.partnership_type_id);
      const capacityVal = form.is_unlimited ? null : Math.max(1, parseInt(String(form.client_capacity), 10) || 1);

      // 1. Create Workspace in database
      const ws = await WorkspacesService.create({
        name: form.name.trim(),
        owner_name: form.owner_name.trim() || form.name.trim(),
        owner_email: email,
        owner_phone: form.owner_phone.trim() || null,
        partnership_type_id: form.partnership_type_id || null,
        platform_plan: selectedPt?.code === 'enterprise' ? 'enterprise' : 'starter',
        client_capacity: capacityVal,
        timezone: form.timezone,
        currency: form.currency,
        status: form.status,
        settings: {
          timezone: form.timezone,
          currency: form.currency,
          default_follow_up_day: 'saturday',
          notes: form.notes,
        },
        notes: form.notes,
      });

      // 2. Provision / Invite Authenticated Brand Owner
      let inviteStatus = 'sent';
      const activationUrl = `${getAppBaseUrl()}/activate?email=${encodeURIComponent(email)}`;

      // Check if profile exists already
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id, email, account_status')
        .eq('email', email)
        .maybeSingle();

      if (existingProfile?.id) {
        // User already has profile: link immediately
        await supabase.from('workspaces').update({ owner_id: existingProfile.id }).eq('id', ws.id);
        await supabase.from('workspace_memberships').upsert({
          workspace_id: ws.id,
          user_id: existingProfile.id,
          workspace_role: 'workspace_owner',
          status: 'active',
        }, { onConflict: 'workspace_id,user_id' });

        inviteStatus = 'existing_linked';
      } else {
        // Send Supabase Auth magic invitation link with activation redirect
        try {
          await supabase.auth.signInWithOtp({
            email,
            options: {
              emailRedirectTo: activationUrl,
              data: {
                full_name: form.owner_name.trim() || form.name.trim(),
                role: 'workspace_owner',
              },
            },
          });
        } catch (inviteErr) {
          console.warn('Auth invitation email warning:', inviteErr);
        }
      }

      // 3. Show provisioning completion & shareable fallback
      setProvisionResult({
        workspace: ws,
        email,
        inviteStatus,
        activationUrl,
      });
    } catch (err) {
      setError(err.message || 'Failed to create workspace');
    } finally {
      setSaving(false);
    }
  };

  if (provisionResult) {
    return (
      <Modal open onClose={onCreated} title="Workspace Created & Brand Owner Provisioned" size="lg">
        <div className="space-y-4 py-2">
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="text-[14px] font-semibold text-foreground">
                Workspace "{provisionResult.workspace.name}" is Ready!
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {provisionResult.inviteStatus === 'existing_linked'
                  ? `The Brand Owner (${provisionResult.email}) already has an account and has been immediately linked as Workspace Owner.`
                  : `An invitation email was sent to ${provisionResult.email} to activate their account and set their password.`}
              </p>
            </div>
          </div>

          <div className="surface-card p-4 space-y-2 border border-border">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-foreground">Activation / Invitation Fallback Link</span>
              <span className="text-[11px] text-muted-foreground">Share securely with the brand owner</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={provisionResult.activationUrl}
                className="flex-1 h-9 px-3 rounded-md bg-secondary/50 border border-border text-[12px] font-mono text-muted-foreground select-all"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleCopyLink(provisionResult.activationUrl)}
              >
                {copied ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                {copied ? 'Copied' : 'Copy Link'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The owner can use this link to set their personal password and immediately access their isolated workspace portal.
            </p>
          </div>

          <RegistrationLinkRow token={provisionResult.workspace.public_join_token} />

          <div className="flex justify-end pt-2">
            <Button onClick={onCreated}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Create Workspace" size="lg">
      {error && (
        <div className="mb-3 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 rounded-md bg-primary/5 border border-primary/15 text-[12px] text-muted-foreground">
          Platform Owners provision customer workspaces. An authenticated Brand Owner account will be invited and connected immediately with full multi-tenant isolation.
        </div>

        <Input
          label="Workspace / Brand Name *"
          value={form.name}
          onChange={set('name')}
          placeholder="e.g. Apex Performance Coaching"
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Brand Owner Name"
            value={form.owner_name}
            onChange={set('owner_name')}
            placeholder="e.g. Coach Alexander"
          />
          <Input
            label="Brand Owner Phone"
            value={form.owner_phone}
            onChange={set('owner_phone')}
            placeholder="+20 10x xxx xxxx"
          />
        </div>

        <Input
          label="Brand Owner Email *"
          type="email"
          value={form.owner_email}
          onChange={set('owner_email')}
          placeholder="owner@brand.com"
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Partnership Type *"
            value={form.partnership_type_id}
            onChange={set('partnership_type_id')}
            required
          >
            {partnershipTypesLoading ? (
              <option value="" disabled>
                Loading…
              </option>
            ) : partnershipTypesError ? (
              <option value="" disabled>
                Unable to load Partnership Types
              </option>
            ) : partnershipTypes.length === 0 ? (
              <option value="" disabled>
                No Partnership Types available
              </option>
            ) : (
              <>
                <option value="" disabled>
                  Select Partnership Type
                </option>
                {partnershipTypes.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.name}
                  </option>
                ))}
              </>
            )}
          </Select>

          <Select label="Status" value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </Select>
        </div>

        {/* Client Capacity Configuration */}
        <div className="surface-card p-3 border border-border space-y-3">
          <label className="text-[13px] font-medium text-foreground block">Client Capacity</label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="radio"
                name="capacity_type"
                checked={form.is_unlimited}
                onChange={() => setForm({ ...form, is_unlimited: true })}
                className="text-primary focus:ring-primary"
              />
              <span>Unlimited Active Clients</span>
            </label>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="radio"
                name="capacity_type"
                checked={!form.is_unlimited}
                onChange={() => setForm({ ...form, is_unlimited: false })}
                className="text-primary focus:ring-primary"
              />
              <span>Capped Capacity</span>
            </label>
          </div>

          {!form.is_unlimited && (
            <div className="pt-2">
              <Input
                label="Maximum Active Clients *"
                type="number"
                min="1"
                value={form.client_capacity}
                onChange={set('client_capacity')}
                placeholder="50"
                required
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                A warning is displayed at 90% utilization. Adding clients beyond this limit requires Platform Owner override.
              </p>
            </div>
          )}
        </div>

        {/* Operational Timezone & Currency */}
        <div className="grid grid-cols-2 gap-3">
          <Select label="Timezone *" value={form.timezone} onChange={set('timezone')}>
            <option value="Africa/Cairo">Africa/Cairo (UTC+2 / UTC+3)</option>
            <option value="Asia/Riyadh">Asia/Riyadh (UTC+3)</option>
            <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
            <option value="Europe/London">Europe/London (GMT/BST)</option>
            <option value="UTC">UTC</option>
          </Select>

          <Select label="Currency *" value={form.currency} onChange={set('currency')}>
            <option value="EGP">EGP (Egyptian Pound)</option>
            <option value="SAR">SAR (Saudi Riyal)</option>
            <option value="AED">AED (UAE Dirham)</option>
            <option value="USD">USD (US Dollar)</option>
            <option value="EUR">EUR (Euro)</option>
            <option value="KWD">KWD (Kuwaiti Dinar)</option>
          </Select>
        </div>

        <TextArea
          label="Internal Notes"
          rows={2}
          value={form.notes}
          onChange={set('notes')}
          placeholder="Operational arrangements, billing terms, partnership notes…"
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating & Inviting…
              </>
            ) : (
              'Create & Invite Owner'
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}