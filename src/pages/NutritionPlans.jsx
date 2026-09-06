import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { NutritionService } from '@/services/nutrition';
import { PlansService } from '@/services/plans';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Modal } from '@/components/ui';
import { Apple, Search, Plus, FilePlus, Copy, ArrowRight, Trash2, Edit3, User, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NutritionPlans() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('client'); // client | template

  // New Plan Selection Modal State
  const [newPlanModalOpen, setNewPlanModalOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const canCreate = hasPermission(user, 'nutrition.create');

  // Server-side template search (RLS-scoped to the active workspace / platform owner)
  const runTemplateSearch = (q) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    PlansService.searchTemplates({
      query: trimmed,
      source: 'nutrition',
      workspaceId: user?.active_workspace_id,
    })
      .then((rows) => setSearchResults(rows || []))
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false));
  };

  useEffect(() => {
    loadPlans();
  }, [view]);

  const loadPlans = async () => {
    try {
      setLoading(true);
      const [clientData, templateData] = await Promise.all([
        NutritionService.list({ is_template: false }),
        NutritionService.list({ is_template: true }),
      ]);
      setPlans(clientData || []);
      setTemplates(templateData || []);
    } catch (err) {
      console.error('Error loading nutrition plans:', err);
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
      return matchName || matchClient;
    });
  }, [currentList, search]);

  const filteredTemplatesForModal = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return templates;
    return searchResults !== null ? searchResults : templates.filter((t) => t.name?.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, templateSearch, searchResults]);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this nutrition plan?')) return;
    try {
      await NutritionService.delete(id);
      loadPlans();
    } catch (err) {
      console.error('Failed to delete plan:', err);
    }
  };

  if (loading) return <LoadingState label="Loading nutrition plans…" />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Nutrition Plans"
        description="Meal plans and templates"
        icon={Apple}
        actions={
          canCreate && (
            <Button onClick={() => setNewPlanModalOpen(true)}>
              <Plus className="w-4 h-4" /> New Plan
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
          Client Plans ({plans.length})
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
          placeholder={view === 'client' ? 'Search by plan or client…' : 'Search templates…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
        />
      </div>

      {/* Plans Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Apple}
          title={view === 'client' ? 'No client plans found' : 'No templates found'}
          description={
            view === 'client'
              ? 'Create a custom nutrition plan or build from a template.'
              : 'Create reusable meal templates for quick client plan generation.'
          }
          action={
            canCreate && (
              <Button onClick={() => setNewPlanModalOpen(true)}>
                <Plus className="w-4 h-4" /> {view === 'client' ? 'Create First Plan' : 'Create First Template'}
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/nutrition/builder/${p.id}`)}
              className="surface-card p-5 hover:glow-subtle transition-all cursor-pointer rounded-2xl border border-border flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-[14px] font-semibold text-foreground group-hover:text-primary transition-colors">
                    {p.name}
                  </h3>
                  <Badge className="text-[10px] font-mono capitalize">
                    {p.is_template ? 'Template' : 'Active'}
                  </Badge>
                </div>

                {!p.is_template && p.client_name && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-3">
                    <User className="w-3 h-3 text-primary" />
                    <span>{p.client_name}</span>
                    {p.client_code && <span className="font-mono text-muted-foreground/80">({p.client_code})</span>}
                  </div>
                )}

                {/* Macro Summary Pills */}
                <div className="grid grid-cols-4 gap-1 text-center py-2 px-1 rounded-lg bg-secondary/30 border border-border/40 text-[11px] font-mono">
                  <div>
                    <span className="text-[9px] text-muted-foreground block font-sans uppercase">Cal</span>
                    <span className="font-semibold text-primary">{Math.round(p.daily_calories || 0)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground block font-sans uppercase">P</span>
                    <span>{Math.round(p.daily_protein || 0)}g</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground block font-sans uppercase">C</span>
                    <span>{Math.round(p.daily_carbs || 0)}g</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground block font-sans uppercase">F</span>
                    <span>{Math.round(p.daily_fat || 0)}g</span>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground mt-3">
                  {p.meals?.length || 0} meals configured
                </p>
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-between pt-4 mt-3 border-t border-border/40 text-xs text-muted-foreground">
                {p.is_template ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/nutrition/builder?templateId=${p.id}`);
                    }}
                    className="flex items-center gap-1 text-primary hover:underline font-medium"
                  >
                    <Copy className="w-3.5 h-3.5" /> Use as Template
                  </button>
                ) : (
                  <span className="text-[11px]">Click to edit</span>
                )}

                <button
                  type="button"
                  onClick={(e) => handleDelete(p.id, e)}
                  className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Archive plan"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Plan Selection Modal */}
      <Modal
        open={newPlanModalOpen}
        onClose={() => setNewPlanModalOpen(false)}
        title="Create Nutrition Plan"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose how you would like to build your new nutrition plan.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Blank Plan Card */}
            <button
              type="button"
              onClick={() => {
                setNewPlanModalOpen(false);
                navigate('/nutrition/builder');
              }}
              className="surface-card p-4 rounded-xl border border-border text-left hover:border-primary/50 hover:bg-secondary/30 transition-all flex flex-col justify-between group"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                <FilePlus className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Blank Plan
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Start fresh with an empty layout and add meals & foods from scratch.
                </p>
              </div>
            </button>

            {/* New Template Card */}
            <button
              type="button"
              onClick={() => {
                setNewPlanModalOpen(false);
                navigate('/nutrition/builder?type=template');
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
                  Build a reusable template for future client nutrition assignments.
                </p>
              </div>
            </button>
          </div>

          {/* From Template Section */}
          <div className="pt-2 border-t border-border">
            <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5 text-primary" /> Or Build from Existing Template
            </h4>

            {templates.length === 0 && searchResults === null ? (
              <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/60 rounded-lg">
                No templates saved yet. You can create one or save any plan as a template.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search templates…"
                    value={templateSearch}
                    onChange={(e) => { setTemplateSearch(e.target.value); runTemplateSearch(e.target.value); }}
                    className="w-full h-8 pl-8 pr-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/40"
                  />
                </div>

                <div className="max-h-40 overflow-y-auto divide-y divide-border/40 border border-border rounded-lg p-1">
                  {searching ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">Searching…</p>
                  ) : filteredTemplatesForModal.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">
                      {templateSearch.trim() ? 'No matching templates.' : 'No templates saved yet.'}
                    </p>
                  ) : (
                    filteredTemplatesForModal.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setNewPlanModalOpen(false);
                          navigate(`/nutrition/builder?templateId=${t.id}`);
                        }}
                        className="w-full text-left p-2 rounded-md hover:bg-secondary/50 flex items-center justify-between text-xs transition-colors"
                      >
                        <div>
                          <span className="font-medium text-foreground block">{t.name}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {Math.round(t.daily_calories || 0)} kcal · {(t.meals_count ?? t.meals?.length ?? 0)} meals
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