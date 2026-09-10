import React, { useState, useEffect, useCallback, useMemo } from 'react';

import { supabase } from '@/utils/supabase';
import { useAuth } from '@/lib/AuthContext';
import { FormRulesService } from '@/services/formRules';
import { TemplatesService } from '@/services/assessments';
import { isPlatformAdmin, getActiveWorkspaceId } from '@/lib/ybs-auth';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Modal, Input, Select } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/ybs-utils';
import { cn } from '@/lib/utils';
import { Workflow, Plus, Pencil, Trash2, Globe, Building2, Repeat, History, Power, Timer } from 'lucide-react';

const TRIGGER_LABELS = {
  client_approval: 'On Client Approval',
  weekly: 'Every Week',
  biweekly: 'Every 2 Weeks',
  nutrition_workout: 'When Nutrition + Workout Plans Are Assigned',
  subscription_renewal: 'On Subscription Renewal',
};

const TRIGGER_OPTIONS = [
  { value: 'client_approval', label: 'On Client Approval' },
  { value: 'weekly', label: 'Every Week' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'nutrition_workout', label: 'When Nutrition + Workout Plans Are Assigned' },
  { value: 'subscription_renewal', label: 'On Subscription Renewal' },
];

const RECURRENCE_LABELS = {
  weekly: 'Every 7 days — advances after each cycle',
  biweekly: 'Every 14 days — advances after each cycle',
};

const STATUS_STYLES = {
  assigned: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  submitted: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  reviewed: 'bg-green-500/10 text-green-400 border-green-500/20',
  skipped: 'bg-muted text-muted-foreground border-border/40',
};

const emptyRule = {
  name: '',
  form_template_id: '',
  trigger_type: 'client_approval',
  workspace_id: null,
  is_enabled: true,
};

export default function FormRules() {
  const { user } = useAuth();
  const isAdmin = isPlatformAdmin(user);
  const activeWsId = getActiveWorkspaceId(user);

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [instances, setInstances] = useState([]);
  const [instancesLoading, setInstancesLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('rules');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyRule);
  const [audienceMode, setAudienceMode] = useState('all');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  const [deleting, setDeleting] = useState(null);

  const loadRules = useCallback(async () => {
    const data = await FormRulesService.listRules();
    setRules(data || []);
  }, []);

  const loadTemplates = useCallback(async () => {
    const data = await TemplatesService.list({});
    setTemplates((data || []).filter((t) => t.is_active && !t.is_archived));
  }, []);

  const loadWorkspaces = useCallback(async () => {
    if (!isAdmin) return;
    const rpc = await supabase.rpc('get_workspaces_overview');
    if (!rpc.error && Array.isArray(rpc.data)) {
      setWorkspaces(rpc.data);
      return;
    }
    const { data } = await supabase.from('workspaces').select('*').order('created_at', { ascending: false });
    setWorkspaces(data || []);
  }, [isAdmin]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([loadRules(), loadTemplates(), loadWorkspaces()]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [loadRules, loadTemplates, loadWorkspaces]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadInstances = useCallback(async () => {
    try {
      setInstancesLoading(true);
      const data = await FormRulesService.listInstances({});
      setInstances(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setInstancesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'history') loadInstances();
  }, [activeTab, loadInstances]);

  const ruleNameById = useMemo(() => {
    const map = {};
    (rules || []).forEach((r) => { map[r.id] = r.name; });
    return map;
  }, [rules]);

  const templateOptions = useMemo(
    () => (templates || []).map((t) => ({ value: t.id, label: t.name, workspace_id: t.workspace_id })),
    [templates]
  );

  const workspaceNameById = useMemo(() => {
    const map = {};
    (workspaces || []).forEach((w) => { map[w.id] = w.name; });
    return map;
  }, [workspaces]);

  const audienceLabel = useCallback((rule) => {
    if (!rule.workspace_id) return { icon: Globe, text: 'All Workspaces', className: 'border-primary/30 text-primary' };
    return { icon: Building2, text: workspaceNameById[rule.workspace_id] || 'Specific Workspace', className: 'border-border/40 text-foreground' };
  }, [workspaceNameById]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyRule });
    setAudienceMode(isAdmin ? 'all' : 'workspace');
    setFormError('');
    setFormSuccess('');
    setEditorOpen(true);
  };

  const openEdit = (rule) => {
    setEditing(rule);
    setForm({
      name: rule.name,
      form_template_id: rule.form_template_id || '',
      trigger_type: rule.trigger_type,
      workspace_id: rule.workspace_id || null,
      is_enabled: rule.is_enabled,
    });
    setAudienceMode(isAdmin && !rule.workspace_id ? 'all' : (isAdmin ? 'specific' : 'workspace'));
    setFormError('');
    setFormSuccess('');
    setEditorOpen(true);
  };

  const handleToggle = async (rule, nextEnabled) => {
    const previous = rules;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_enabled: nextEnabled } : r)));
    try {
      await FormRulesService.setEnabled(rule.id, nextEnabled);
    } catch (err) {
      setRules(previous);
      console.error(err);
    }
  };

  const handleSave = async () => {
    try {
      if (!form.name?.trim()) {
        setFormError('Rule name is required.');
        return;
      }
      if (!form.form_template_id) {
        setFormError('Please select a form template.');
        return;
      }

      setSaving(true);
      setFormError('');
      setFormSuccess('');

      const workspace_id = isAdmin
        ? (audienceMode === 'specific' ? form.workspace_id : null)
        : (editing ? form.workspace_id : null);

      if (editing) {
        await FormRulesService.update(editing.id, {
          name: form.name.trim(),
          form_template_id: form.form_template_id,
          trigger_type: form.trigger_type,
          workspace_id,
          is_enabled: form.is_enabled,
        });
        setFormSuccess('Rule updated successfully.');
      } else {
        await FormRulesService.create({
          name: form.name.trim(),
          form_template_id: form.form_template_id,
          trigger_type: form.trigger_type,
          workspace_id,
          is_enabled: form.is_enabled,
        });
        setFormSuccess('Rule created successfully.');
      }

      await loadRules();
      setSaving(false);
    } catch (err) {
      setSaving(false);
      setFormError(err.message || 'Failed to save rule.');
    }
  };

  const handleDelete = async (rule) => {
    if (!window.confirm(`Delete rule "${rule.name}"? Automatic assignments that already happened are kept.`)) return;
    try {
      await FormRulesService.remove(rule.id);
      await loadRules();
    } catch (err) {
      console.error(err);
      window.alert(err.message || 'Failed to delete rule.');
    }
    setDeleting(null);
  };

  const recurring = ['weekly', 'biweekly'].includes(form.trigger_type);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Form Automation"
        description="Automatically assign forms to clients based on configurable rules"
        icon={Workflow}
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" /> New Rule
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-0.5 bg-secondary/30 rounded-lg w-fit">
        {[
          { key: 'rules', label: 'Rules', icon: Workflow },
          { key: 'history', label: 'Assignment History', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-all',
                activeTab === tab.key
                  ? 'bg-card text-foreground shadow-sm border border-border/50'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Rules Tab ── */}
      {activeTab === 'rules' && (
        loading ? <LoadingState label="Loading form automation rules…" /> :
        rules.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="No form rules yet"
            description="Create your first rule to automatically assign forms to clients."
            action={<Button onClick={openCreate}><Plus className="w-4 h-4" /> New Rule</Button>}
          />
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => {
              const audience = audienceLabel(rule);
              const AudienceIcon = audience.icon;
              return (
                <div key={rule.id} className="surface-card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold">{rule.name}</p>
                      {!rule.is_enabled && <Badge className="bg-muted text-muted-foreground">Paused</Badge>}
                      {!rule.form_template_id && <Badge className="bg-red-500/10 text-red-400 border-red-500/20">Template missing</Badge>}
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">{rule.template_name || 'Form unavailable'}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <Badge className="bg-white/5 text-foreground border border-white/10">{TRIGGER_LABELS[rule.trigger_type] || rule.trigger_type}</Badge>
                      <Badge className={cn('bg-white/5 border', audience.className)}>
                        <AudienceIcon className="w-3 h-3 mr-1 inline" /> {audience.text}
                      </Badge>
                      {['weekly', 'biweekly'].includes(rule.trigger_type) && (
                        <Badge className="bg-white/5 text-foreground border border-white/10">
                          <Timer className="w-3 h-3 mr-1 inline" /> {RECURRENCE_LABELS[rule.trigger_type]}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ToggleRule isOn={rule.is_enabled} onClick={() => handleToggle(rule, !rule.is_enabled)} />
                    <Button variant="secondary" size="sm" onClick={() => openEdit(rule)}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setDeleting(rule)} disabled={deleting?.id === rule.id}>
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── History Tab ── */}
      {activeTab === 'history' && (
        instancesLoading ? <LoadingState label="Loading assignment history…" /> :
        instances.length === 0 ? (
          <EmptyState
            icon={History}
            title="No automatic assignments yet"
            description="Assignments generated by your form rules will appear here."
            action={<Button variant="secondary" onClick={() => setActiveTab('rules')}><Workflow className="w-4 h-4" /> View Rules</Button>}
          />
        ) : (
          <div className="surface-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Form</th>
                    <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Rule</th>
                    <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Client</th>
                    <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Trigger</th>
                    <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Assigned</th>
                    <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Next Due</th>
                    <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((inst) => (
                    <tr key={inst.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 text-[13px] font-medium">{inst.form_name || '—'}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{ruleNameById[inst.rule_id] || 'Deleted rule'}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">
                        {inst.client_name || '—'}
                        {inst.client_code ? <span className="block text-[11px] opacity-70">{inst.client_code}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{TRIGGER_LABELS[inst.trigger_type] || inst.trigger_type}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDateTime(inst.assigned_at)}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{inst.next_due_at ? formatDate(inst.next_due_at) : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge className={cn(STATUS_STYLES[inst.status] || 'bg-muted text-muted-foreground', 'capitalize')}>{inst.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* ── Rule Editor Modal ── */}
      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editing ? 'Edit Rule' : 'New Form Automation Rule'} size="lg">
        <div className="space-y-4">
          <Input
            label="Rule name"
            placeholder="e.g. Weekly check-in form"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />

          <Select
            label="Form template"
            value={form.form_template_id || ''}
            onChange={(e) => setForm((f) => ({ ...f, form_template_id: e.target.value }))}
          >
            <option value="">Select a form template…</option>
            {templateOptions.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>

          <Select
            label="Trigger"
            value={form.trigger_type}
            onChange={(e) => setForm((f) => ({ ...f, trigger_type: e.target.value }))}
          >
            {TRIGGER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>

          {recurring && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5">
              <Repeat className="w-3.5 h-3.5" />
              {RECURRENCE_LABELS[form.trigger_type]}
            </div>
          )}

          {/* Audience */}
          {isAdmin ? (
            <div className="space-y-2">
              <p className="text-[12px] font-medium text-muted-foreground">Audience</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setAudienceMode('all'); setForm((f) => ({ ...f, workspace_id: null })); }}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] transition-all',
                    audienceMode === 'all'
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-white/10 text-muted-foreground hover:border-white/20'
                  )}
                >
                  <Globe className="w-4 h-4" /> All Workspaces
                </button>
                <button
                  type="button"
                  onClick={() => { setAudienceMode('specific'); }}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] transition-all',
                    audienceMode === 'specific'
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-white/10 text-muted-foreground hover:border-white/20'
                  )}
                >
                  <Building2 className="w-4 h-4" /> Specific Workspace
                </button>
              </div>
              {audienceMode === 'specific' && (
                <Select
                  label="Workspace"
                  value={form.workspace_id || ''}
                  onChange={(e) => setForm((f) => ({ ...f, workspace_id: e.target.value || null }))}
                >
                  <option value="">Select a workspace…</option>
                  {(workspaces || []).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </Select>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2.5">
              <Building2 className="w-3.5 h-3.5" />
              Applies to all clients in your active workspace{activeWsId ? ` (${workspaceNameById[activeWsId] || 'active'})` : ''}
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div>
              <p className="text-[13px] font-medium">Enabled</p>
              <p className="text-[11px] text-muted-foreground">Paused rules never assign forms.</p>
            </div>
            <ToggleRule isOn={form.is_enabled} onClick={() => setForm((f) => ({ ...f, is_enabled: !f.is_enabled }))} />
          </div>

          {formError && <p className="text-[12px] text-red-400">{formError}</p>}
          {formSuccess && <p className="text-[12px] text-green-400">{formSuccess}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Rule'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Minimal on/off toggle styled with the app palette.
function ToggleRule({ isOn, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={isOn}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 shrink-0',
        isOn ? 'bg-primary' : 'bg-white/10'
      )}
    >
      <Power className={cn('w-3 h-3 text-white absolute left-1.5 transition-opacity', isOn ? 'opacity-100' : 'opacity-40')} />
      <span
        className={cn(
          'block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
          isOn ? 'translate-x-[22px]' : 'translate-x-[2px]'
        )}
      />
    </button>
  );
}