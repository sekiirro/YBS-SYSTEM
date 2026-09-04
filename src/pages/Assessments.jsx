import React, { useState, useEffect, useMemo, useCallback } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { AssessmentsService, TemplatesService, QuestionsService } from '@/services/assessments';
import { ClientsService } from '@/services/clients';
import { hasPermission } from '@/lib/permissions';
import { getActiveWorkspaceId, isPlatformAdmin } from '@/lib/ybs-auth';
import { WorkspacesService } from '@/services/workspaces';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Modal, Input } from '@/components/ui';
import { formatDate, getFormStatusColor } from '@/lib/ybs-utils';
import { ClipboardList, Search, Plus, Send, Eye, FileText, LayoutTemplate, ChevronRight, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import FormBuilder from '@/components/FormBuilder';

export default function Assessments() {
  const { user } = useAuth();
  const wsId = getActiveWorkspaceId(user);
  const [activeTab, setActiveTab] = useState('forms');
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Builder state
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);

  // Assign state
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTemplate, setAssignTemplate] = useState(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [dueDate, setDueDate] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');

  // View response state
  const [viewingForm, setViewingForm] = useState(null);

  // Template → Workspace assignment state (Platform Owner only)
  const [assignWsOpen, setAssignWsOpen] = useState(false);
  const [assignWsTemplate, setAssignWsTemplate] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceSelection, setWorkspaceSelection] = useState({});
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignWsError, setAssignWsError] = useState('');

  const isAdmin = isPlatformAdmin(user);
  const isTrainer = isPlatformAdmin(user) || user?.platform_role === 'platform_trainer'
    || (user?.managed_workspace_ids && user.managed_workspace_ids.length > 0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [formData, templateData] = await Promise.all([
        AssessmentsService.list({}),
        isTrainer ? TemplatesService.list({}) : Promise.resolve([]),
      ]);
      setForms(formData);
      setTemplates(templateData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isTrainer]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filtering ──
  const filteredForms = useMemo(() => {
    return forms.filter((f) => {
      if (search) {
        const q = search.toLowerCase();
        if (!f.name?.toLowerCase().includes(q) && !f.assigned_client_name?.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== 'all' && f.submission_status !== statusFilter) return false;
      return true;
    });
  }, [forms, search, statusFilter]);

  const filteredTemplates = useMemo(() => {
    if (!search) return templates;
    const q = search.toLowerCase();
    return templates.filter((t) => t.name?.toLowerCase().includes(q));
  }, [templates, search]);

  // ── Form Builder save ──
  const handleFormSave = async (formData) => {
    if (formData.id) {
      // Update existing template
      await TemplatesService.update(formData.id, {
        name: formData.name,
        description: formData.description,
        status: formData.status,
      });
      await QuestionsService.bulkUpsert(formData.id, formData.questions);
    } else {
      // Create new template
      const template = await TemplatesService.create({
        workspace_id: wsId,
        name: formData.name,
        description: formData.description,
        status: formData.status,
        created_by: user.id,
      });
      await QuestionsService.bulkUpsert(template.id, formData.questions);
    }
    setEditingTemplate(null);
    await loadData();
  };

  // ── Assign flow ──
  const openAssign = async (template) => {
    setAssignTemplate(template);
    setAssignOpen(true);
    setAssignSearch('');
    setSelectedClient(null);
    setDueDate('');
    setAssignError('');
    setClientsLoading(true);
    try {
      const data = await ClientsService.list({});
      setClients(data);
    } catch (err) {
      console.error(err);
    } finally {
      setClientsLoading(false);
    }
  };

  const filteredClients = useMemo(() => {
    if (!assignSearch) return clients;
    const q = assignSearch.toLowerCase();
    return clients.filter((c) =>
      c.full_name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.client_code?.toLowerCase().includes(q)
    );
  }, [clients, assignSearch]);

  const handleAssign = async () => {
    if (!selectedClient) { setAssignError('Please select a client'); return; }
    setAssigning(true);
    setAssignError('');
    try {
      await AssessmentsService.assignToClient({
        templateId: assignTemplate.id,
        clientId: selectedClient.id,
        workspaceId: selectedClient.workspace_id || wsId,
        coachId: user.id,
        name: assignTemplate.name,
        dueDate: dueDate || null,
      });
      setAssignOpen(false);
      await loadData();
    } catch (err) {
      console.error(err);
      setAssignError(err.message || 'Failed to assign form');
    } finally {
      setAssigning(false);
    }
  };

  // ── Edit template ──
  const openEdit = async (template) => {
    try {
      const full = await TemplatesService.getById(template.id);
      setEditingTemplate(full);
      setBuilderOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  // ── Delete template ──
  const handleDeleteTemplate = async (id) => {
    if (!window.confirm('Delete this template? Existing assignments will keep their snapshot.')) return;
    try {
      await TemplatesService.delete(id);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  // ── Assign master template to workspaces (Platform Owner only) ──
  const openAssignToWorkspaces = async (template) => {
    setAssignWsError('');
    setAssignWsTemplate(template);
    setAssignWsOpen(true);
    try {
      const data = await WorkspacesService.list();
      setWorkspaces((data || []).filter((w) => w.status === 'active'));
      const selected = (template.assigned_workspace_ids || []).reduce((acc, id) => {
        acc[id] = true;
        return acc;
      }, {});
      setWorkspaceSelection(selected);
    } catch (err) {
      console.error(err);
      setAssignWsError('Failed to load workspaces.');
    }
  };

  const toggleWorkspaceAssignment = (wsId) => {
    setWorkspaceSelection((prev) => ({ ...prev, [wsId]: !prev[wsId] }));
  };

  const handleSaveAssignment = async () => {
    if (!assignWsTemplate) return;
    setSavingAssignment(true);
    setAssignWsError('');
    const original = (assignWsTemplate.assigned_workspace_ids || []);
    const originalSet = new Set(original);
    try {
      const tasks = [];
      for (const w of workspaces) {
        const nowSelected = !!workspaceSelection[w.id];
        if (nowSelected && !originalSet.has(w.id)) {
          tasks.push(TemplatesService.assignToWorkspace(assignWsTemplate.id, w.id));
        } else if (!nowSelected && originalSet.has(w.id)) {
          tasks.push(TemplatesService.unassignFromWorkspace(assignWsTemplate.id, w.id));
        }
      }
      await Promise.all(tasks);
      setAssignWsOpen(false);
      setAssignWsTemplate(null);
      await loadData();
    } catch (err) {
      console.error(err);
      setAssignWsError(err.message || 'Failed to update workspace assignments.');
    } finally {
      setSavingAssignment(false);
    }
  };

  const openAssignToWorkspacesClose = () => {
    setAssignWsOpen(false);
    setAssignWsTemplate(null);
    setAssignWsError('');
  };

  // ── View responses ──
  const openView = async (form) => {
    try {
      const full = await AssessmentsService.getById(form.id);
      setViewingForm(full);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <LoadingState label="Loading forms…" />;

  const TABS = [
    { key: 'forms', label: 'Forms', icon: FileText },
    ...(isTrainer ? [{ key: 'templates', label: 'Templates', icon: LayoutTemplate }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Forms"
        description="Create, assign, and manage client forms"
        icon={ClipboardList}
        actions={
          hasPermission(user, 'forms.create') && (
            <Button onClick={() => { setEditingTemplate(null); setBuilderOpen(true); }}>
              <Plus className="w-4 h-4" /> New Form
            </Button>
          )
        }
      />

      {/* Tabs */}
      {TABS.length > 1 && (
        <div className="flex gap-1 mb-4 p-0.5 bg-secondary/30 rounded-lg w-fit">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSearch(''); setStatusFilter('all'); }}
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
      )}

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={activeTab === 'forms' ? 'Search forms…' : 'Search templates…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
          />
        </div>
        {activeTab === 'forms' && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="submitted">Submitted</option>
            <option value="reviewed">Reviewed</option>
            <option value="overdue">Overdue</option>
          </select>
        )}
      </div>

      {/* ── Forms Tab ── */}
      {activeTab === 'forms' && (
        <>
          {filteredForms.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No forms found" description="Assign forms to clients from the Templates tab" />
          ) : (
            <div className="surface-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Form</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Client</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Due Date</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Submitted</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                      <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredForms.map((f) => (
                      <tr key={f.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-[13px] font-medium">{f.name}</p>
                          <p className="text-[11px] text-muted-foreground">{f.response_count || 0} responses</p>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{f.assigned_client_name || '—'}</td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(f.due_date)}</td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(f.submitted_at)}</td>
                        <td className="px-4 py-3">
                          <Badge className={cn(getFormStatusColor(f.submission_status), 'capitalize')}>{f.submission_status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {f.submission_status === 'submitted' && (
                            <Button variant="ghost" size="sm" onClick={() => openView(f)}>
                              <Eye className="w-3.5 h-3.5" /> View
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Templates Tab ── */}
      {activeTab === 'templates' && (
        <>
          {filteredTemplates.length === 0 ? (
            <EmptyState
              icon={LayoutTemplate}
              title="No templates yet"
              description="Create your first form template"
              action={
                hasPermission(user, 'forms.create') && (
                  <Button onClick={() => { setEditingTemplate(null); setBuilderOpen(true); }}>
                    <Plus className="w-4 h-4" /> New Form
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-3">
              {filteredTemplates.map((t) => (
                <div key={t.id} className="surface-card p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                      <LayoutTemplate className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-medium">{t.name}</p>
                        <Badge className={cn(
                          t.status === 'published'
                            ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                            : 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                          'capitalize'
                        )}>
                          {t.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {t.question_count} questions · Created {formatDate(t.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {t.workspace_id == null && isAdmin && (
                      <Button variant="outline" size="sm" onClick={() => openAssignToWorkspaces(t)}>
                        <Building2 className="w-3.5 h-3.5" /> Workspaces
                        {(t.assigned_workspace_ids?.length || 0) > 0 && (
                          <span className="ml-1 text-[10px] font-mono bg-secondary px-1.5 py-0.5 rounded">
                            {t.assigned_workspace_ids.length}
                          </span>
                        )}
                      </Button>
                    )}
                    {t.status === 'published' && hasPermission(user, 'forms.assign') && (
                      <Button variant="outline" size="sm" onClick={() => openAssign(t)}>
                        <Send className="w-3.5 h-3.5" /> Assign
                      </Button>
                    )}
                    {hasPermission(user, 'forms.update') && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>Edit</Button>
                    )}
                    {hasPermission(user, 'forms.delete') && (
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteTemplate(t.id)}
                        className="text-red-400 hover:text-red-300">Delete</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Form Builder Modal ── */}
      <FormBuilder
        open={builderOpen}
        onClose={() => { setBuilderOpen(false); setEditingTemplate(null); }}
        onSave={handleFormSave}
        initialData={editingTemplate}
      />

      {/* ── Assign Modal ── */}
      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign Form to Client" size="lg">
        <div className="space-y-4">
          {assignTemplate && (
            <div className="p-3 rounded-lg bg-secondary/30 border border-border/50">
              <p className="text-[13px] font-medium">{assignTemplate.name}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{assignTemplate.question_count} questions</p>
            </div>
          )}

          {assignError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">{assignError}</div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search clients by name, email, or code…"
              value={assignSearch}
              onChange={(e) => setAssignSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
            />
          </div>

          {clientsLoading ? (
            <div className="py-6 text-center text-muted-foreground text-[13px]">Loading clients…</div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1 border border-border/50 rounded-lg p-1">
              {filteredClients.length === 0 ? (
                <p className="py-4 text-center text-muted-foreground text-[12px]">No clients found</p>
              ) : (
                filteredClients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedClient(c)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors',
                      selectedClient?.id === c.id
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-secondary/50 border border-transparent'
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-[12px] font-bold text-primary shrink-0">
                      {c.full_name?.[0] || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate">{c.full_name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{c.client_code} · {c.email || c.phone}</p>
                    </div>
                    {selectedClient?.id === c.id && (
                      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <ChevronRight className="w-3 h-3 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          <Input
            label="Due Date (optional)"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={assigning || !selectedClient}>
              <Send className="w-3.5 h-3.5" />
              {assigning ? 'Assigning…' : 'Assign Form'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Assign Master Template to Workspaces Modal ── */}
      <Modal open={assignWsOpen} onClose={openAssignToWorkspacesClose} title="Assign Master Template to Workspaces" size="lg">
        <div className="space-y-4">
          {assignWsTemplate && (
            <div className="p-3 rounded-lg bg-secondary/30 border border-border/50">
              <p className="text-[13px] font-medium">{assignWsTemplate.name}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Master template · visible only to workspaces selected below.
              </p>
            </div>
          )}

          {assignWsError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">{assignWsError}</div>
          )}

          <div className="max-h-72 overflow-y-auto space-y-1 border border-border/50 rounded-lg p-1">
            {workspaces.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-[12px]">No active workspaces found</p>
            ) : (
              workspaces.map((w) => {
                const selected = !!workspaceSelection[w.id];
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => toggleWorkspaceAssignment(w.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                      selected
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-secondary/50 border border-transparent'
                    )}
                  >
                    <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-[12px] font-mono text-foreground shrink-0">
                      {(w.name?.[0] || 'W').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate">{w.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{w.owner_name || w.slug || ' '}</p>
                    </div>
                    <div
                      className={cn(
                        'w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors',
                        selected ? 'bg-primary border-primary' : 'border-border'
                      )}
                    >
                      {selected && <span className="text-primary-foreground text-[11px]">✓</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={openAssignToWorkspacesClose}>Cancel</Button>
            <Button onClick={handleSaveAssignment} disabled={savingAssignment}>
              <Building2 className="w-3.5 h-3.5" />
              {savingAssignment ? 'Saving Assignments…' : 'Save Assignments'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── View Responses Modal ── */}
      <Modal open={!!viewingForm} onClose={() => setViewingForm(null)} title="Form Responses" size="lg">
        {viewingForm && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
              <div>
                <p className="text-[13px] font-medium">{viewingForm.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Submitted {formatDate(viewingForm.submitted_at)}</p>
              </div>
              <Badge className={cn(getFormStatusColor(viewingForm.submission_status), 'capitalize')}>
                {viewingForm.submission_status}
              </Badge>
            </div>

            {(viewingForm.questions_snapshot || []).sort((a, b) => a.sort_order - b.sort_order).map((q, idx) => {
              const resp = (viewingForm.assessment_responses || []).find(r => r.question_id === q.id);
              const val = resp?.response_value;
              const displayVal = val == null ? '—' : (Array.isArray(val) ? val.join(', ') : String(val));
              return (
                <div key={q.id} className="space-y-1">
                  <p className="text-[12px] font-medium text-muted-foreground">Q{idx + 1}. {q.label}</p>
                  <p className="text-[13px] text-foreground pl-4">{displayVal || '—'}</p>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}