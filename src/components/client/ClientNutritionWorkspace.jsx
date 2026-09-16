import React, { useState, useEffect, useCallback } from 'react';
import { NutritionService } from '@/services/nutrition';
import { AssessmentsService } from '@/services/assessments';
import NutritionPlanBuilder from '@/pages/NutritionPlanBuilder';
import FormSubmissionPanel from '@/components/FormSubmissionPanel';
import GeminiAnalysisPanel from '@/components/GeminiAnalysisPanel';
import SlidingPlannerLayout from '@/components/client/SlidingPlannerLayout';
import { LoadingState, Button, Badge, Modal } from '@/components/ui';
import {
  ArrowLeft, Plus, FilePlus, Copy, Search, ArrowRight, Trash2,
  ChevronDown, ChevronRight, ClipboardList, Sparkles, Apple,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Client-Centric Nutrition Workspace — 3-Column Sliding Layout.
 *
 * Column 1: Plan list + Form Submissions accordion
 * Column 2: Embedded NutritionPlanBuilder for the selected plan
 * Column 3: (Handled internally by NutritionPlanBuilder — meal editing)
 *
 * The builder already handles all meal/food editing inline, so columns 2+3
 * are rendered together via the NutritionPlanBuilder in embedded mode.
 * The "3-column" progressive disclosure is achieved by:
 *   step=1 → plan list only
 *   step=2 → plan list + builder (which contains meals + detail editing)
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
  const [templateSearch, setTemplateSearch] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  // Accordion states: independent
  const [isPlansOpen, setIsPlansOpen] = useState(true);
  const [isFormsOpen, setIsFormsOpen] = useState(false);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);

  const plannerStep = editor ? 2 : 1;

  const reloadPlans = useCallback(async () => {
    if (!clientId) return;
    try {
      const data = await NutritionService.list({ client_id: clientId });
      setPlans(data || []);
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
  };

  const openFromTemplate = (templateId) => {
    setNewPlanOpen(false);
    setEditor({ mode: 'template', templateId });
  };

  const closeEditor = async () => {
    setEditor(null);
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

  const filteredTemplates = templates.filter((t) => {
    const q = templateSearch.trim().toLowerCase();
    return !q || t.name?.toLowerCase().includes(q);
  });

  if (loading) return <LoadingState label="Loading nutrition plans…" />;

  // ─── Column 1: Plan List + Form Submissions + Analysis ──────────
  const column1Content = (
    <div className="p-4 space-y-4">
      {/* 1. Nutrition Plans Section */}
      <div>
        <button
          type="button"
          onClick={() => setIsPlansOpen((prev) => !prev)}
          className="flex items-center justify-between w-full text-left group py-1"
        >
          <h3 className="text-[14px] font-display font-semibold flex items-center gap-2">
            <Apple className="w-4 h-4 text-muted-foreground" />
            Nutrition Plans
          </h3>
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground transition-transform duration-200",
              isPlansOpen ? "rotate-0" : "-rotate-90"
            )}
          />
        </button>

        <div
          className={cn(
            "grid transition-all duration-200 ease-in-out",
            isPlansOpen ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 mt-0"
          )}
        >
          <div className="overflow-hidden">
            {plans.length === 0 ? (
              <Button
                size="lg"
                onClick={() => setNewPlanOpen(true)}
                className="w-full h-auto min-h-[72px] px-6 py-5 rounded-xl text-base sm:text-lg font-semibold flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
              >
                <Plus className="w-5 h-5" /> New Plan
              </Button>
            ) : (
              <div className="space-y-2">
                <Button size="sm" className="w-full" onClick={() => setNewPlanOpen(true)}>
                  <Plus className="w-3.5 h-3.5" /> New Plan
                </Button>

                {plans.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setEditor({ mode: 'edit', planId: p.id })}
                    className={cn(
                      'p-3 rounded-lg border cursor-pointer transition-colors',
                      editor?.planId === p.id
                        ? 'bg-primary/10 border-primary/30'
                        : 'bg-secondary/30 border-border hover:border-primary/40'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium truncate">{p.name}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge className={cn(
                          'text-[10px] font-mono capitalize shrink-0',
                          p.status === 'draft' ? 'text-amber-400 bg-amber-500/10 border-amber-500/25'
                          : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
                        )}>
                          {p.status === 'draft' ? 'Draft' : 'Active'}
                        </Badge>
                        <button
                          type="button"
                          onClick={(e) => handleRemovePlan(p, e)}
                          className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Remove plan"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                      {p.daily_calories != null && <span>Cal: {p.daily_calories}</span>}
                      {p.daily_protein != null && <span>P: {p.daily_protein}g</span>}
                      {p.daily_carbs != null && <span>C: {p.daily_carbs}g</span>}
                      {p.daily_fat != null && <span>F: {p.daily_fat}g</span>}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {p.nutrition_meals?.length || p.meals?.length || 0} meals
                    </p>
                  </div>
                ))}
              </div>
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
              "w-4 h-4 text-muted-foreground transition-transform duration-200",
              isFormsOpen ? "rotate-0" : "-rotate-90"
            )}
          />
        </button>

        <div
          className={cn(
            "grid transition-all duration-200 ease-in-out",
            isFormsOpen ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 mt-0"
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
              "w-4 h-4 text-muted-foreground transition-transform duration-200",
              isAnalysisOpen ? "rotate-0" : "-rotate-90"
            )}
          />
        </button>

        <div
          className={cn(
            "grid transition-all duration-200 ease-in-out",
            isAnalysisOpen ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 mt-0"
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

  // ─── Column 2+3: Embedded Builder ───────────────────────────────
  const column2Content = editor ? (
    <div className="p-4">
      <button
        type="button"
        onClick={closeEditor}
        className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-3 md:hidden"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to plans
      </button>
      <NutritionPlanBuilder
        key={JSON.stringify(editor)}
        templateId={editor.mode === 'template' ? editor.templateId : undefined}
        initialPlanId={editor.mode === 'edit' ? editor.planId : undefined}
        clientId={clientId}
        clientName={clientName}
        workspaceId={workspaceId}
        embedded
        onExit={closeEditor}
      />
    </div>
  ) : null;

  return (
    <>
      <SlidingPlannerLayout
        step={plannerStep}
        column1={column1Content}
        column2={column2Content}
        column3={null}
        onBack={closeEditor}
      />

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
              className="surface-card p-4 rounded-xl border border-border text-left hover:border-primary/50 hover:bg-secondary/30 transition-all flex flex-col justify-between group"
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
              onClick={() => { setShowTemplates(true); loadTemplates(); }}
              className="surface-card p-4 rounded-xl border border-border text-left hover:border-purple-500/50 hover:bg-secondary/30 transition-all flex flex-col justify-between group"
            >
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3">
                <Copy className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground group-hover:text-purple-400 transition-colors">
                  Load From Template
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Duplicate an existing template as an independent copy for this client.
                </p>
              </div>
            </button>
          </div>

          {showTemplates && (
            <div id="client-nutrition-templates" className="pt-2 border-t border-border">
              <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Copy className="w-3.5 h-3.5 text-primary" /> Or choose a template below
              </h4>

              {templatesLoading ? (
                <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/60 rounded-lg">
                  Loading nutrition templates…
                </p>
              ) : templatesError ? (
                <div className="py-3 text-center border border-dashed border-red-500/40 rounded-lg">
                  <p className="text-xs text-red-400">{templatesError}</p>
                  <button
                    type="button"
                    onClick={loadTemplates}
                    className="text-xs text-primary hover:underline mt-1"
                  >
                    Retry
                  </button>
                </div>
              ) : templates.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/60 rounded-lg">
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
                      className="w-full h-8 pl-8 pr-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/40"
                    />
                  </div>

                  <div className="max-h-40 overflow-y-auto divide-y divide-border/40 border border-border rounded-lg p-1">
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
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {Math.round(t.daily_calories || 0)} kcal · {(t.meals?.length || 0)} meals
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
  return React.useMemo(() => {
    if (!forms || forms.length === 0) return null;
    const sorted = [...forms].sort(
      (a, b) =>
        new Date(b.submitted_at || b.updated_at || b.created_at) -
        new Date(a.submitted_at || a.updated_at || a.created_at)
    );
    return sorted[0].id;
  }, [forms]);
}