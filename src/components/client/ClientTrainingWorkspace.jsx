import React, { useState, useEffect, useCallback } from 'react';
import { WorkoutsService } from '@/services/workouts';
import { AssessmentsService } from '@/services/assessments';
import WorkoutPlanBuilder from '@/pages/WorkoutPlanBuilder';
import FormSubmissionPanel from '@/components/FormSubmissionPanel';
import GeminiAnalysisPanel from '@/components/GeminiAnalysisPanel';
import PremiumPlannerLayout from '@/components/workouts/PremiumPlannerLayout';
import { LoadingState, Button, Modal } from '@/components/ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft, Plus, FilePlus, Copy, Search, ArrowRight, Trash2,
  ChevronDown, ChevronRight, ClipboardList, Sparkles, Dumbbell,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Client-Centric Training Workspace — 3-Column Sliding Layout.
 *
 * Column 1: Program list + Form Submissions accordion
 * Column 2: Embedded WorkoutPlanBuilder for the selected program
 *
 * The builder already handles day editing, exercises, sets/reps/rest inline,
 * so columns 2+3 are rendered together via WorkoutPlanBuilder in embedded mode.
 */
export default function ClientTrainingWorkspace({ client }) {
  const clientId = client?.id;
  const clientName = client?.full_name;
  const workspaceId = client?.workspace_id;

  // null | { mode: 'new' } | { mode: 'template', templateId } | { mode: 'edit', planId }
  const [editor, setEditor] = useState(null);
  const [planToDelete, setPlanToDelete] = useState(null);
  const [plans, setPlans] = useState([]);
  const [forms, setForms] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [starting, setStarting] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  // Accordion states: independent
  const [isPlansOpen, setIsPlansOpen] = useState(true);
  const [isFormsOpen, setIsFormsOpen] = useState(false);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);

  // Mobile nav step: 1 = program sidebar, 2 = plan editor
  const [mobileStep, setMobileStep] = useState(1);

  // When an editor opens/closes, sync mobile step
  useEffect(() => {
    setMobileStep(editor ? 2 : 1);
  }, [editor]);

  const reloadPlans = useCallback(async () => {
    if (!clientId) return;
    try {
      const data = await WorkoutsService.list({ client_id: clientId });
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
      console.error('Failed to reload workout programs:', err);
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
      const data = await WorkoutsService.list({ is_template: true });
      setTemplates(data || []);
      setTemplatesLoaded(true);
    } catch (err) {
      console.error('Failed to load workout templates:', err);
      setTemplatesError('Failed to load templates. Please try again.');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const openNewProgram = () => {
    if (starting) return;
    setStarting(true);
    setNewPlanOpen(false);
    setEditor({ mode: 'new' });
  };

  const openFromTemplate = (templateId) => {
    if (starting) return;
    setStarting(true);
    setNewPlanOpen(false);
    setEditor({ mode: 'template', templateId });
  };

  const closeEditor = async () => {
    setStarting(false);
    setEditor(null);
    await reloadPlans();
  };

  const handleRemovePlan = (plan, e) => {
    e.stopPropagation();
    setPlanToDelete(plan);
  };

  const executeRemovePlan = async () => {
    if (!planToDelete) return;
    try {
      await WorkoutsService.delete(planToDelete.id);
      if (editor?.planId === planToDelete.id) {
        setEditor(null);
      }
      await reloadPlans();
    } catch (err) {
      console.error('Failed to remove workout program:', err);
    } finally {
      setPlanToDelete(null);
    }
  };

  const filteredTemplates = templates.filter((t) => {
    const q = templateSearch.trim().toLowerCase();
    return !q || t.name?.toLowerCase().includes(q);
  });

  if (loading) return <LoadingState label="Loading workout programs…" />;

  // ─── Column 1: Program List + Form Submissions + Analysis ───────
  const column1Content = (
    <div className="p-4 space-y-4">
      {/* 1. Workout Programs Section */}
      <div>
        <button
          type="button"
          onClick={() => setIsPlansOpen((prev) => !prev)}
          className="flex items-center justify-between w-full text-left group py-1"
        >
          <h3 className="text-[14px] font-display font-semibold flex items-center gap-2">
            <Dumbbell className="w-4 h-4 text-muted-foreground" />
            Workout Programs
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
                className="w-full h-auto min-h-[60px] px-5 py-4 rounded-xl text-base font-semibold flex items-center justify-center gap-2 shadow-sm border border-primary/20 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Plus className="w-4 h-4" /> New Program
              </Button>
            ) : (
              <div className="space-y-2">
                <Button size="sm" className="w-full text-xs" onClick={() => setNewPlanOpen(true)}>
                  <Plus className="w-3.5 h-3.5" /> New Program
                </Button>

                {plans.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setEditor({ mode: 'edit', planId: p.id })}
                    className={cn(
                      'group relative p-3 rounded-xl border cursor-pointer transition-colors duration-150 select-none',
                      editor?.planId === p.id
                        ? 'bg-card border-primary/50 shadow-sm before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-primary before:rounded-r'
                        : 'bg-card/40 border-border/40 hover:border-border/80 hover:bg-card'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[14px] font-semibold text-foreground truncate">{p.name}</p>
                      <button
                        type="button"
                        onClick={(e) => handleRemovePlan(p, e)}
                        className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                        title="Remove program"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[12px] text-muted-foreground capitalize font-medium">
                        {(p.split_type || 'custom').replace(/_/g, ' ')} · {p.days?.length || 0} sessions
                      </span>
                      <span className="text-[12px] text-muted-foreground">·</span>
                      <span className="text-[12px] text-primary font-mono font-medium">
                        {p.total_working_sets || 0} working sets/wk
                      </span>
                    </div>
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

      {/* 3. Generate Training Analysis Section */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setIsAnalysisOpen((prev) => !prev)}
          className="flex items-center justify-between w-full text-left group py-1"
        >
          <h3 className="text-[14px] font-display font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Generate Training Analysis
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
              analysisType="training"
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
          <WorkoutPlanBuilder
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
                  <Dumbbell className="w-7 h-7 text-muted-foreground/30" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">No Workout Programs</p>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    This client does not have any workout programs yet. Click &ldquo;New Program&rdquo; to start.
                  </p>
                </div>
                <Button onClick={() => setNewPlanOpen(true)} className="text-xs shadow-sm">
                  <Plus className="w-3.5 h-3.5" /> New Program
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

      {/* New Program Selection Modal */}
      <Modal
        open={newPlanOpen}
        onClose={() => setNewPlanOpen(false)}
        title="Create Workout Program"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose how you would like to build this client's workout program.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={openNewProgram}
              disabled={starting}
              className="surface-card p-4 rounded-xl border border-border text-left hover:border-primary/50 hover:bg-secondary/30 transition-all flex flex-col justify-between group disabled:opacity-50 disabled:pointer-events-none"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                <FilePlus className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Create New Program
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Start fresh with an empty layout and save it as a draft for this client.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => { setShowTemplates(true); loadTemplates(); }}
              disabled={starting}
              className="surface-card p-4 rounded-xl border border-border text-left hover:border-purple-500/50 hover:bg-secondary/30 transition-all flex flex-col justify-between group disabled:opacity-50 disabled:pointer-events-none"
            >
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3">
                <Copy className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground group-hover:text-purple-400 transition-colors">
                  Load From Template
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Duplicate an existing template as an independent program for this client.
                </p>
              </div>
            </button>
          </div>

          {showTemplates && (
            <div id="client-workout-templates" className="pt-2 border-t border-border">
              <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Copy className="w-3.5 h-3.5 text-primary" /> Or choose a template below
              </h4>

              {templatesLoading ? (
                <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/60 rounded-lg">
                  Loading workout templates…
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
                  No templates available. You can create one from the Workout Plans page.
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
                      filteredTemplates.map((t) => {
                        const tplDays = t.days || [];
                        const sessionCount = tplDays.filter((d) => !(d.day_type === 'rest_day' || !!d.rest_day)).length;
                        const restCount = tplDays.filter((d) => d.day_type === 'rest_day' || !!d.rest_day).length;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => openFromTemplate(t.id)}
                            disabled={starting}
                            className="w-full text-left p-2 rounded-md hover:bg-secondary/50 flex items-center justify-between text-xs transition-colors disabled:opacity-50 disabled:pointer-events-none"
                          >
                            <div>
                              <span className="font-medium text-foreground block">{t.name}</span>
                              <span className="text-[12px] text-muted-foreground font-mono">
                                {(t.split_type || 'custom').replace(/_/g, ' ')} · {sessionCount} sessions · {restCount} rest days
                              </span>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Remove Program Confirmation Dialog */}
      <AlertDialog open={planToDelete !== null} onOpenChange={(open) => !open && setPlanToDelete(null)}>
        <AlertDialogContent className="max-w-md bg-card border border-border/80">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground text-sm font-semibold">
              Remove Workout Program?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-xs leading-relaxed">
              Are you sure you want to remove &ldquo;{planToDelete?.name}&rdquo; from this client? The program will be archived and stop being shown to the client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeRemovePlan}
              className="text-xs h-8 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove Program
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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