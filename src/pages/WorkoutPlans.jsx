import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { WorkoutsService } from '@/services/workouts';
import { hasPermission } from '@/lib/permissions';
import { getRoleCategory, getActiveWorkspaceId } from '@/lib/ybs-auth';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Modal } from '@/components/ui';
import { Dumbbell, Search, Plus, FilePlus, Copy, ArrowRight, Trash2, Edit3, User, Sparkles, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function WorkoutPlans() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('client'); // 'client' | 'template'

  // New Plan Selection Modal State
  const [newPlanModalOpen, setNewPlanModalOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  const canCreate = hasPermission(user, 'workout.create');

  // Workspace owners are scoped to their own workspace exercise plans.
  // The platform owner and platform trainers see everything RLS allows.
  const wsId = getActiveWorkspaceId(user);
  const scopeFilter = getRoleCategory(user) === 'workspace' && wsId ? { workspace_id: wsId } : {};

  useEffect(() => {
    loadPlans();
  }, [view]);

  const loadPlans = async () => {
    try {
      setLoading(true);
      const [clientData, templateData] = await Promise.all([
        WorkoutsService.list({ is_template: false, ...scopeFilter }),
        WorkoutsService.list({ is_template: true, ...scopeFilter }),
      ]);
      setPlans(clientData || []);
      setTemplates(templateData || []);
    } catch (err) {
      console.error('Error loading workout plans:', err);
    } finally {
      setLoading(false);
    }
  };

  const currentList = view === 'client' ? plans : templates;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return currentList;
    return currentList.filter((p) => {
      const matchName = p.name?.toLowerCase().includes(q);
      const matchClient = p.client_name?.toLowerCase().includes(q) || p.client_code?.toLowerCase().includes(q);
      const matchSplit = p.split_type?.toLowerCase().includes(q) || p.custom_split_name?.toLowerCase().includes(q);
      return matchName || matchClient || matchSplit;
    });
  }, [currentList, search]);

  const filteredTemplatesForModal = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name?.toLowerCase().includes(q) || t.split_type?.toLowerCase().includes(q));
  }, [templates, templateSearch]);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to archive this workout program?')) return;
    try {
      await WorkoutsService.delete(id);
      loadPlans();
    } catch (err) {
      console.error('Failed to delete workout plan:', err);
    }
  };

  if (loading) return <LoadingState label="Loading workout programs & templates…" />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Workout Programming"
        description="Client training programs, splits, and workout templates"
        icon={Dumbbell}
        actions={
          canCreate && (
            <Button onClick={() => setNewPlanModalOpen(true)}>
              <Plus className="w-4 h-4" /> New Program
            </Button>
          )
        }
      />

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => { setView('client'); setSearch(''); }}
          className={cn(
            'px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
            view === 'client'
              ? 'bg-secondary text-foreground border border-border'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Client Programs ({plans.length})
        </button>
        <button
          onClick={() => { setView('template'); setSearch(''); }}
          className={cn(
            'px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
            view === 'template'
              ? 'bg-secondary text-foreground border border-border'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Templates ({templates.length})
        </button>
      </div>

      {/* Search Input */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder={view === 'client' ? 'Search by program, split, or client…' : 'Search templates…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
        />
      </div>

      {/* Plans Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title={view === 'client' ? 'No client workout programs' : 'No workout templates'}
          description={
            view === 'client'
              ? 'Create a custom workout program or build from a training template.'
              : 'Create reusable workout templates for rapid client assignment.'
          }
          action={
            canCreate && (
              <Button onClick={() => setNewPlanModalOpen(true)}>
                <Plus className="w-4 h-4" /> {view === 'client' ? 'Create First Program' : 'Create First Template'}
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const splitDisplayName = p.split_type === 'custom' && p.custom_split_name
              ? p.custom_split_name
              : (p.split_type || 'custom').replace(/_/g, ' ');

            const topMuscles = (p.muscle_distribution || []).slice(0, 3);

            return (
              <div
                key={p.id}
                onClick={() => navigate(`/workouts/builder/${p.id}`)}
                className="surface-card p-5 hover:glow-subtle transition-all cursor-pointer rounded-2xl border border-border flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-[14px] font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                      {p.name}
                    </h3>
                    <Badge className="text-[10px] font-mono capitalize shrink-0">
                      {p.is_template ? 'Template' : 'Active'}
                    </Badge>
                  </div>

                  {!p.is_template && p.client_name && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-3">
                      <User className="w-3 h-3 text-primary shrink-0" />
                      <span className="truncate">{p.client_name}</span>
                      {p.client_code && <span className="font-mono text-muted-foreground/80 shrink-0">({p.client_code})</span>}
                    </div>
                  )}

                  {/* Split and Session Info */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-0.5 rounded-md bg-secondary text-[11px] font-medium text-foreground capitalize border border-border/50">
                      {splitDisplayName}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {p.days?.length || 0} {p.days?.length === 1 ? 'day' : 'days'}
                    </span>
                  </div>

                  {/* Volume Metric Pill */}
                  <div className="p-3 rounded-xl bg-secondary/30 border border-border/40 mb-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Activity className="w-3 h-3 text-primary" /> Total Working Volume
                      </span>
                      <span className="font-mono text-[13px] font-semibold text-primary">
                        {p.total_working_sets || 0} <span className="text-[10px] font-normal text-muted-foreground font-sans">sets/wk</span>
                      </span>
                    </div>

                    {topMuscles.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border/30">
                        {topMuscles.map((m) => (
                          <span
                            key={m.muscle}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-background/50 border border-border/30 text-muted-foreground capitalize"
                          >
                            {m.muscle}: <span className="font-mono text-foreground font-medium">{m.sets}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-border/40 text-xs text-muted-foreground">
                  {p.is_template ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/workouts/builder?templateId=${p.id}`);
                      }}
                      className="flex items-center gap-1 text-primary hover:underline font-medium"
                    >
                      <Copy className="w-3.5 h-3.5" /> Use as Template
                    </button>
                  ) : (
                    <span className="text-[11px] group-hover:text-foreground transition-colors flex items-center gap-1">
                      <Edit3 className="w-3 h-3" /> Edit Program
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={(e) => handleDelete(p.id, e)}
                    className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Archive program"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Plan Selection Modal */}
      <Modal
        open={newPlanModalOpen}
        onClose={() => setNewPlanModalOpen(false)}
        title="Create Workout Program"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose how you would like to build your new workout program or template.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Blank Plan Card */}
            <button
              type="button"
              onClick={() => {
                setNewPlanModalOpen(false);
                navigate('/workouts/builder');
              }}
              className="surface-card p-4 rounded-xl border border-border text-left hover:border-primary/50 hover:bg-secondary/30 transition-all flex flex-col justify-between group"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                <FilePlus className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Blank Program
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Start fresh with custom split, days, exercises, sets, reps, and RPE.
                </p>
              </div>
            </button>

            {/* New Template Card */}
            <button
              type="button"
              onClick={() => {
                setNewPlanModalOpen(false);
                navigate('/workouts/builder?type=template');
              }}
              className="surface-card p-4 rounded-xl border border-border text-left hover:border-purple-500/50 hover:bg-secondary/30 transition-all flex flex-col justify-between group"
            >
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3">
                <Sparkles className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground group-hover:text-purple-400 transition-colors">
                  New Template
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Build a reusable training template for fast, repeatable client assignments.
                </p>
              </div>
            </button>
          </div>

          {/* From Template Section */}
          <div className="pt-2 border-t border-border">
            <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5 text-primary" /> Or Build from Existing Template
            </h4>

            {templates.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/60 rounded-lg">
                No templates saved yet. You can create one or save any program as a template.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search templates…"
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    className="w-full h-8 pl-8 pr-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/40"
                  />
                </div>

                <div className="max-h-40 overflow-y-auto divide-y divide-border/40 border border-border rounded-lg p-1">
                  {filteredTemplatesForModal.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">No matching templates.</p>
                  ) : (
                    filteredTemplatesForModal.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setNewPlanModalOpen(false);
                          navigate(`/workouts/builder?templateId=${t.id}`);
                        }}
                        className="w-full text-left p-2 rounded-md hover:bg-secondary/50 flex items-center justify-between text-xs transition-colors"
                      >
                        <div>
                          <span className="font-medium text-foreground block">{t.name}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {(t.split_type || 'custom').replace(/_/g, ' ')} · {t.days?.length || 0} days · {t.total_working_sets || 0} working sets
                          </span>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}