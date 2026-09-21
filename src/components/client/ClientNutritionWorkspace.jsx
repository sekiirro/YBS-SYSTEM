import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { NutritionService } from '@/services/nutrition';
import { AssessmentsService } from '@/services/assessments';
import NutritionPlanBuilder from '@/pages/NutritionPlanBuilder';
import FormSubmissionPanel from '@/components/FormSubmissionPanel';
import GeminiAnalysisPanel from '@/components/GeminiAnalysisPanel';
import PremiumPlannerLayout from '@/components/workouts/PremiumPlannerLayout';
import { LoadingState, Button, Badge, Modal } from '@/components/ui';
import {
  Plus,
  FilePlus,
  Copy,
  Search,
  ArrowRight,
  Trash2,
  ChevronDown,
  ClipboardList,
  Sparkles,
  Apple,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Client-Centric Nutrition Workspace — Master-Detail 3-Column Architecture.
 *
 * Column 1: Plan list + Form Submissions accordion + AI Nutrition Analysis
 * Column 2: Plan Overview + Meal Master List (embedded NutritionPlanBuilder)
 * Column 3: Meal Deep Food Editor (slides in when meal is selected)
 */
export default function ClientNutritionWorkspace({ client }) {
  const clientId = client?.id;
  const clientName = client?.full_name;
  const workspaceId = client?.workspace_id;

  // Planner state machine
  // null | { mode: 'new' } | { mode: 'template', templateId } | { mode: 'edit', planId }
  const [editor, setEditor] = useState(null);
  const [plans, setPlans] = useState([]);
  const [forms, setForms] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [planSearch, setPlanSearch] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  // Accordion states: independent
  const [isPlansOpen, setIsPlansOpen] = useState(true);
  const [isFormsOpen, setIsFormsOpen] = useState(false);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);

  // Mobile navigation step: 1 = sidebar, 2 = plan overview
  const [mobileStep, setMobileStep] = useState(1);

  const reloadPlans = useCallback(async () => {
    if (!clientId) return;
    try {
      const data = await NutritionService.list({ client_id: clientId });
      const loadedPlans = data || [];
      setPlans(loadedPlans);
      setEditor((curr) => {
        if (curr?.mode === 'new' || curr?.mode === 'template') {
          return curr;
        }
        if (curr?.planId && loadedPlans.some((p) => p.id === curr.planId)) {
          return curr;
        }
        if (loadedPlans.length > 0) {
          const activePlan = loadedPlans.find((p) => p.status === 'active' || p.is_active) || loadedPlans[0];
          return { mode: 'edit', planId: activePlan.id };
        }
        return null;
      });
    } catch (err) {
      console.error('Failed to reload nutrition plans:', err);
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    reloadPlans().finally(() => setLoading(false));
  }, [clientId, reloadPlans]);

  // Latest submitted form feeds the Gemini analysis panel.
  useEffect(() => {
    if (!clientId) return;
    AssessmentsService.list({ client_id: clientId })
      .then((list) =>
        setForms((list || []).filter(
          (f) => f.submission_status === 'submitted' || f.submission_status === 'reviewed'
        ))
      )
      .catch(() => setForms([]));
  }, [clientId]);

  const latestAssessmentId = useMemoLatestAssessment(forms);

  const loadTemplates = async () => {
    if (templatesLoaded) return;
    setTemplatesLoading(true);
    setTemplatesError('');
    try {
      const data = await NutritionService.list({ is_template: true });
      setTemplates(data || []);
      setTemplatesLoaded(true);
    } catch (err) {
      console.error('Failed to load nutrition templates:', err);
      setTemplatesError('Failed to load templates. Please try again.');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const openNewPlan = () => {
    setNewPlanOpen(false);
    setEditor({ mode: 'new' });
    setMobileStep(2);
  };

  const openFromTemplate = (templateId) => {
    setNewPlanOpen(false);
    setEditor({ mode: 'template', templateId });
    setMobileStep(2);
  };

  const closeEditor = async () => {
    setEditor(null);
    setMobileStep(1);
    await reloadPlans();
  };

  const handleRemovePlan = async (plan, e) => {
    e.stopPropagation();
    if (!window.confirm(`Remove "${plan.name}" from this client? The plan will be archived and stop being shown to the client.`)) return;
    try {
      await NutritionService.delete(plan.id);
      await reloadPlans();
    } catch (err) {
      console.error('Failed to remove nutrition plan:', err);
    }
  };

  const filteredPlans = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((p) => p.name?.toLowerCase().includes(q));
  }, [plans, planSearch]);

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name?.toLowerCase().includes(q));
  }, [templates, templateSearch]);

  if (loading) return <LoadingState label="Loading nutrition workspace…" />;

  // ─── Column 1: Master Navigation Sidebar ────────────────────────
  const column1Content = (
    <div className="p-4 space-y-4">
      {/* 1. Nutrition Plans Section */}
      <div>
        <div className="flex items-center justify-between py-1">
          <button
            type="button"
            onClick={() => setIsPlansOpen((prev) => !prev)}
            className="flex items-center gap-2 text-left group"
          >
            <Apple className="w-4 h-4 text-primary" />
            <h3 className="text-[14px] font-display font-semibold text-foreground">
              Nutrition Plans
            </h3>
            <span className="text-[12px] font-mono font-medium px-1.5 py-0.2 rounded-full bg-secondary/80 text-muted-foreground">
              {plans.length}
            </span>
            <ChevronDown
              className={cn(
                'w-3.5 h-3.5 text-muted-foreground transition-transform duration-200',
                isPlansOpen ? 'rotate-0' : '-rotate-90'
              )}
            />
          </button>
          <Button
            size="sm"
            onClick={() => setNewPlanOpen(true)}
            className="text-[12px] h-7 px-2.5 shadow-sm"
          >
            <Plus className="w-3 h-3" /> New Plan
          </Button>
        </div>

        <div
          className={cn(
            'grid transition-all duration-200 ease-in-out',
            isPlansOpen ? 'grid-rows-[1fr] opacity-100 mt-2.5' : 'grid-rows-[0fr] opacity-0 mt-0'
          )}
        >
          <div className="overflow-hidden space-y-2">
            {plans.length > 3 && (
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter plans…"
                  value={planSearch}
                  onChange={(e) => setPlanSearch(e.target.value)}
                  className="w-full h-7 pl-8 pr-2.5 rounded-lg bg-secondary/40 border border-border text-[12px] focus:outline-none focus:border-primary/50"
                />
              </div>
            )}

            {plans.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-border/70 text-center space-y-2 bg-secondary/10">
                <p className="text-xs text-muted-foreground">No nutrition plans yet</p>
                <Button
                  size="sm"
                  onClick={() => setNewPlanOpen(true)}
                  className="w-full text-xs h-8"
                >
                  <Plus className="w-3.5 h-3.5" /> Create First Plan
                </Button>
              </div>
            ) : (
              filteredPlans.map((p) => {
                const isActive = editor?.planId === p.id;
                const isDraft = p.status === 'draft';
                const mealCount = p.nutrition_meals?.length || p.meals?.length || 0;

                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      setEditor({ mode: 'edit', planId: p.id });
                      setMobileStep(2);
                    }}
                    className={cn(
                      'group relative rounded-xl border p-3 cursor-pointer transition-all duration-150 select-none',
                      isActive
                        ? 'bg-card border-primary/50 shadow-sm before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-primary before:rounded-r'
                        : 'bg-card/40 border-border/40 hover:border-border/80 hover:bg-card'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[14px] font-semibold text-foreground truncate">
                        {p.name}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge
                          className={cn(
                            'text-[12px] font-mono capitalize shrink-0 border py-0',
                            isDraft
                              ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                              : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          )}
                        >
                          {isDraft ? 'Draft' : 'Active'}
                        </Badge>
                        <button
                          type="button"
                          onClick={(e) => handleRemovePlan(p, e)}
                          className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          title="Remove plan"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-1.5 text-[12px] text-muted-foreground font-mono flex-wrap">
                      {p.daily_calories != null && (
                        <span className="text-primary font-medium">{Math.round(p.daily_calories)} kcal</span>
                      )}
                      {(p.daily_protein != null || p.daily_carbs != null || p.daily_fat != null) && (
                        <>
                          <span>·</span>
                          <span>
                            {p.daily_protein != null ? `${Math.round(p.daily_protein)}P ` : ''}
                            {p.daily_carbs != null ? `${Math.round(p.daily_carbs)}C ` : ''}
                            {p.daily_fat != null ? `${Math.round(p.daily_fat)}F` : ''}
                          </span>
                        </>
                      )}
                      <span>·</span>
                      <span className="font-sans text-muted-foreground/80">{mealCount} meals</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 2. Form Submissions Section */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setIsFormsOpen((prev) => !prev)}
          className="flex items-center justify-between w-full text-left group py-1"
        >
          <h3 className="text-[14px] font-display font-semibold flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-muted-foreground" />
            Form Submissions
          </h3>
          <ChevronDown
            className={cn(
              'w-4 h-4 text-muted-foreground transition-transform duration-200',
              isFormsOpen ? 'rotate-0' : '-rotate-90'
            )}
          />
        </button>

        <div
          className={cn(
            'grid transition-all duration-200 ease-in-out',
            isFormsOpen ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0 mt-0'
          )}
        >
          <div className="overflow-hidden">
            <FormSubmissionPanel clientId={clientId} />
          </div>
        </div>
      </div>

      {/* 3. Generate Nutrition Analysis Section */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setIsAnalysisOpen((prev) => !prev)}
          className="flex items-center justify-between w-full text-left group py-1"
        >
          <h3 className="text-[14px] font-display font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Generate Nutrition Analysis
          </h3>
          <ChevronDown
            className={cn(
              'w-4 h-4 text-muted-foreground transition-transform duration-200',
              isAnalysisOpen ? 'rotate-0' : '-rotate-90'
            )}
          />
        </button>

        <div
          className={cn(
            'grid transition-all duration-200 ease-in-out',
            isAnalysisOpen ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0 mt-0'
          )}
        >
          <div className="overflow-hidden">
            <GeminiAnalysisPanel
              assessmentId={latestAssessmentId}
              analysisType="nutrition"
              clientName={clientName}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="h-[calc(100vh-240px)] min-h-[640px] overflow-hidden">
        {editor ? (
          <NutritionPlanBuilder
            key={editor.mode === 'edit' ? editor.planId : `${editor.mode}-${editor.templateId || 'new'}`}
            templateId={editor.mode === 'template' ? editor.templateId : undefined}
            initialPlanId={editor.mode === 'edit' ? editor.planId : undefined}
            clientId={clientId}
            clientName={clientName}
            workspaceId={workspaceId}
            embedded
            sidebarSlot={column1Content}
            onPlanSaved={reloadPlans}
            onExit={closeEditor}
          />
        ) : (
          <PremiumPlannerLayout
            column1={column1Content}
            column2={
              <div className="flex flex-col items-center justify-center h-full text-center px-8 py-20 space-y-5">
                <div className="w-16 h-16 rounded-2xl bg-secondary/50 border border-border/60 flex items-center justify-center">
                  <Apple className="w-7 h-7 text-muted-foreground/30" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">No Nutrition Plans</p>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    This client does not have any nutrition plans yet. Click &ldquo;New Plan&rdquo; to start.
                  </p>
                </div>
                <Button onClick={() => setNewPlanOpen(true)} className="text-xs shadow-sm">
                  <Plus className="w-3.5 h-3.5" /> New Plan
                </Button>
              </div>
            }
            showColumn3={false}
            step={mobileStep}
            onBackToCol1={() => setMobileStep(1)}
            className="h-full"
          />
        )}
      </div>

      {/* New Plan Selection Modal */}
      <Modal
        open={newPlanOpen}
        onClose={() => setNewPlanOpen(false)}
        title="Create Nutrition Plan"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose how you would like to build this client's nutrition plan.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={openNewPlan}
              className="rounded-xl border border-border/80 bg-card p-4 text-left hover:border-primary/50 hover:bg-secondary/30 transition-all flex flex-col justify-between group shadow-sm"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                <FilePlus className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Create New Plan
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Start fresh with an empty layout and save it as a draft for this client.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowTemplates(true);
                loadTemplates();
              }}
              className="rounded-xl border border-border/80 bg-card p-4 text-left hover:border-sky-500/50 hover:bg-secondary/30 transition-all flex flex-col justify-between group shadow-sm"
            >
              <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mb-3">
                <Copy className="w-4 h-4 text-sky-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground group-hover:text-sky-400 transition-colors">
                  Load From Template
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Duplicate an existing template as an independent copy for this client.
                </p>
              </div>
            </button>
          </div>

          {showTemplates && (
            <div id="client-nutrition-templates" className="pt-3 border-t border-border/40">
              <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Copy className="w-3.5 h-3.5 text-primary" /> Or choose a template below
              </h4>

              {templatesLoading ? (
                <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border/60 rounded-lg">
                  Loading nutrition templates…
                </p>
              ) : templatesError ? (
                <div className="py-4 text-center border border-dashed border-destructive/40 rounded-lg">
                  <p className="text-xs text-destructive">{templatesError}</p>
                  <button
                    type="button"
                    onClick={loadTemplates}
                    className="text-xs text-primary hover:underline mt-1"
                  >
                    Retry
                  </button>
                </div>
              ) : templates.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border/60 rounded-lg">
                  No templates available. You can create one from the Nutrition Plans page.
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
                      className="w-full h-8 pl-8 pr-3 rounded-lg bg-secondary/40 border border-border text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                    />
                  </div>

                  <div className="max-h-48 overflow-y-auto divide-y divide-border/30 border border-border rounded-lg p-1 bg-card">
                    {filteredTemplates.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-3 text-center">No matching templates.</p>
                    ) : (
                      filteredTemplates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => openFromTemplate(t.id)}
                          className="w-full text-left p-2 rounded-md hover:bg-secondary/50 flex items-center justify-between text-xs transition-colors"
                        >
                          <div>
                            <span className="font-medium text-foreground block">{t.name}</span>
                            <span className="text-[12px] text-muted-foreground font-mono">
                              {Math.round(t.daily_calories || 0)} kcal · {t.meals?.length || 0} meals
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
          )}
        </div>
      </Modal>
    </>
  );
}

/** Picks the most-recently-submitted assessment id from the client's forms. */
function useMemoLatestAssessment(forms) {
  return useMemo(() => {
    if (!forms || forms.length === 0) return null;
    const sorted = [...forms].sort(
      (a, b) =>
        new Date(b.submitted_at || b.updated_at || b.created_at) -
        new Date(a.submitted_at || a.updated_at || a.created_at)
    );
    return sorted[0].id;
  }, [forms]);
}