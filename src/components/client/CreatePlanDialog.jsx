import React, { useState, useCallback } from 'react';
import { generatePlanProposal, CreatePlanError, PLAN_KINDS, PLAN_OBJECTIVES } from '@/services/createPlan';
import { OBJECTIVE_META, KIND_META, SEVERITY_STYLES, sortCoachNotes, proposalFingerprint } from '@/lib/createPlanContract';
import {
  Button,
  Badge,
  Modal,
  LoadingState,
  ErrorState,
} from '@/components/ui';
import {
  ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, XCircle, AlertCircle,
  RefreshCw, FileText, Target, Zap, MessageSquare, BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Create Plan Dialog — the coach's review surface for an AI-generated proposal.
 *
 * Flow:
 *   1. Objective picker (if not pre-selected) -> 2. Generate -> 3. Review
 *      (proposal summary, coach notes, unresolved requirements, changes) ->
 *      4. Actions: Regenerate (confirmed discard) / Save Draft or Save & Assign.
 *
 * The proposal is NEVER persisted here. The review is read-only with
 * `useAutosave(enabled: false)` on the downstream planner. "Save" writes
 * through the existing Nutrition `Save Draft` / Training `Save & Assign` buttons.
 */
export default function CreatePlanDialog({
  open,
  onClose,
  assessmentId,
  kind,
  objective: propObjective,
  clientName,
  onSave, // (draft) => void  -- the parent wires this to the planner
}) {
  const isNutrition = kind === 'nutrition';

  // Step state: 'objective' | 'generating' | 'review'
  const [step, setStep] = useState(propObjective ? 'generating' : 'objective');
  const [objective, setObjective] = useState(propObjective || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [draft, setDraft] = useState(null);
  const [meta, setMeta] = useState(null);
  const [regenerateConfirm, setRegenerateConfirm] = useState(false);

  // Reset when dialog closes or assessment/kind changes
  React.useEffect(() => {
    if (!open) {
      setStep(propObjective ? 'generating' : 'objective');
      setObjective(propObjective || '');
      setLoading(false);
      setError(null);
      setProposal(null);
      setDraft(null);
      setMeta(null);
      setRegenerateConfirm(false);
    }
  }, [open, propObjective]);

  const handleGenerate = useCallback(async () => {
    if (loading || !objective) return;
    setLoading(true);
    setError(null);
    setStep('generating');
    try {
      const data = await generatePlanProposal({ assessmentId, kind, objective });
      setProposal(data.proposal);
      setDraft(data.draft);
      setMeta(data.meta);
      setStep('review');
    } catch (err) {
      const message = err instanceof CreatePlanError ? err.message : 'Could not create a plan proposal.';
      const code = err instanceof CreatePlanError ? err.code : 'ai_unavailable';
      setError({ message, code });
      setStep('objective');
    } finally {
      setLoading(false);
    }
  }, [assessmentId, kind, objective, loading]);

  const handleRegenerate = useCallback(() => {
    if (regenerateConfirm) {
      // Actually regenerate
      setRegenerateConfirm(false);
      setProposal(null);
      setDraft(null);
      setMeta(null);
      setStep('generating');
      handleGenerate();
    } else {
      // Ask for confirmation
      setRegenerateConfirm(true);
    }
  }, [regenerateConfirm, handleGenerate]);

  const handleCancelRegenerate = useCallback(() => {
    setRegenerateConfirm(false);
  }, []);

  const handleSave = useCallback(() => {
    if (onSave && draft) {
      onSave({ kind, objective, proposal, draft, meta });
    }
  }, [onSave, draft, kind, objective, proposal, meta]);

  const handleBackToObjective = useCallback(() => {
    if (step === 'generating') return;
    setStep('objective');
    setProposal(null);
    setDraft(null);
    setMeta(null);
    setError(null);
  }, [step]);

  // Step 1: Objective Picker
  if (step === 'objective') {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={`Create ${KIND_META[kind].label} Plan`}
        size="lg"
      >
        <div className="space-y-6">
          <p className="text-[14px] text-foreground/80 leading-relaxed">
            What is the primary goal for {clientName ? `${clientName}'s` : 'this client\'s'} {KIND_META[kind].label.toLowerCase()}?
            The AI will build a starting draft around this objective, which you can review and edit before saving.
          </p>

          {error && (
            <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5">
              <p className="text-sm font-medium text-destructive">{error.message}</p>
            </div>
          )}

          <div className="grid gap-3" role="radiogroup" aria-label="Select objective">
            {PLAN_OBJECTIVES.map((obj) => (
              <label
                key={obj}
                className={cn(
                  'relative flex items-center p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer',
                  objective === obj
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'border-border/70 hover:border-primary/40 hover:bg-primary/[0.02]',
                )}
              >
                <input
                  type="radio"
                  name="create-plan-objective"
                  value={obj}
                  checked={objective === obj}
                  onChange={() => setObjective(obj)}
                  className="sr-only"
                  aria-label={OBJECTIVE_META[obj].label}
                />
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center mr-3 shrink-0 transition-colors duration-200">
                  {objective === obj && <CheckCircle className="w-3 h-3 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground">{OBJECTIVE_META[obj].label}</div>
                  <p className="text-[13px] text-muted-foreground mt-0.5">{OBJECTIVE_META[obj].blurb}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={!objective || loading}
              className="text-xs h-9 px-4"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <Target className="w-3.5 h-3.5 mr-1.5" /> Create Plan
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Step 2: Generating
  if (step === 'generating') {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={`Generating ${KIND_META[kind].label} Plan…`}
        size="lg"
      >
        <LoadingState label="Building your plan proposal" inline />
        <p className="text-center text-[14px] text-muted-foreground mt-4">
          One AI call, your client's real data, real templates and real foods.
        </p>
        {error && (
          <div className="mt-4 p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-center">
            <p className="text-sm font-medium text-destructive">{error.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setError(null); setStep('objective'); }}
              className="mt-2 text-xs"
            >
              Try Again
            </Button>
          </div>
        )}
      </Modal>
    );
  }

  // Step 3: Review
  if (step === 'review' && proposal && draft) {
    const sortedNotes = sortCoachNotes([...(draft.coach_notes || [])]);
    const changes = draft.changes || [];

    return (
      <Modal
        open={open}
        onClose={onClose}
        title={`Review ${KIND_META[kind].label} Plan Proposal`}
        size="lg"
      >
        <div className="space-y-5">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                isNutrition ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary',
              )}>
                {isNutrition ? <BookOpen className="w-5 h-5" /> : <Target className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  {proposal.selection_rationale || `AI ${KIND_META[kind].label} Proposal`}
                </h3>
                <p className="text-[12px] text-muted-foreground">
                  Based on <strong>{proposal.selected_template_ref}</strong> · {objective} · {changes.length} change{changes.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={proposal.schema_version === 'create-plan-v1' ? 'success' : 'default'}>
                v1
              </Badge>
            </div>
          </div>

          {/* Coach Notes */}
          {sortedNotes.length > 0 && (
            <div className="space-y-3">
              <SectionHeader>
                <MessageSquare className="w-4 h-4" />
                Coach Notes ({sortedNotes.length})
              </SectionHeader>
              <div className="space-y-2">
                {sortedNotes.map((note, i) => {
                  const style = SEVERITY_STYLES[note.severity] || SEVERITY_STYLES.info;
                  return (
                    <div
                      key={i}
                      className={cn(
                        'p-3 rounded-lg border flex items-start gap-3',
                        style.tone === 'red' && 'border-destructive/30 bg-destructive/5',
                        style.tone === 'amber' && 'border-warning/30 bg-warning/5',
                        style.tone === 'blue' && 'border-blue-500/30 bg-blue-500/5',
                        style.tone === 'slate' && 'border-border/70 bg-secondary/30',
                      )}
                    >
                      <div className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5', {
                        'bg-destructive/15 text-destructive': style.tone === 'red',
                        'bg-warning/15 text-warning': style.tone === 'amber',
                        'bg-blue-100/30 text-blue-600': style.tone === 'blue',
                        'bg-foreground/10 text-muted-foreground': style.tone === 'slate',
                      })}>
                        {style.tone === 'red' && <AlertTriangle className="w-3.5 h-3.5" />}
                        {style.tone === 'amber' && <AlertCircle className="w-3.5 h-3.5" />}
                        {style.tone === 'blue' && <MessageSquare className="w-3.5 h-3.5" />}
                        {style.tone === 'slate' && <CheckCircle className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={style.tone === 'red' ? 'destructive' : style.tone === 'amber' ? 'warning' : 'default'} className="text-[11px]">
                            {style.label}
                          </Badge>
                          {note.requires_acknowledgement && (
                            <Badge variant="outline" className="text-[11px]">
                              Requires acknowledgement
                            </Badge>
                          )}
                        </div>
                        <p className="text-[13px] text-foreground/90 mt-1">{note.message}</p>
                        {note.suggested_action && (
                          <p className="text-[12px] text-primary mt-1.5 font-medium">
                            Suggested: {note.suggested_action}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Unresolved Requirements */}
          {proposal.unresolved_requirements?.length > 0 && (
            <div className="space-y-3">
              <SectionHeader>
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Unresolved Requirements ({proposal.unresolved_requirements.length})
              </SectionHeader>
              <ul className="space-y-1.5">
                {proposal.unresolved_requirements.map((req, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-foreground/85">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <span>{req}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Changes */}
          {changes.length > 0 && (
            <div className="space-y-3">
              <SectionHeader>
                <FileText className="w-4 h-4" />
                Changes ({changes.length})
              </SectionHeader>
              <div className="space-y-2">
                {changes.map((change, i) => (
                  <div
                    key={i}
                    className={cn(
                      'p-3 rounded-lg border flex items-center gap-3',
                      change.change === 'remove' && 'border-destructive/30 bg-destructive/5',
                      change.change === 'add' && 'border-emerald-500/30 bg-emerald-500/5',
                      change.change === 'update' && 'border-primary/30 bg-primary/5',
                      change.change === 'swap' && 'border-blue-500/30 bg-blue-500/5',
                    )}
                  >
                    <span
                      className={cn(
                        'w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider',
                        change.change === 'remove' && 'text-destructive',
                        change.change === 'add' && 'text-emerald-500',
                        change.change === 'update' && 'text-primary',
                        change.change === 'swap' && 'text-blue-500',
                      )}
                    >
                      {change.change.toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">{change.target_label || change.scope}</p>
                      <p className="text-[12px] text-muted-foreground">{change.detail}</p>
                    </div>
                    <Badge variant="outline" className="text-[11px] shrink-0">
                      {change.scope}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-border/50">
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBackToObjective}
                disabled={loading}
                className="text-xs h-9 px-3"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1.5" /> Change Objective
              </Button>
              {regenerateConfirm ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRegenerate}
                    disabled={loading}
                    className="text-xs h-9 px-3"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Confirm Regenerate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelRegenerate}
                    className="text-xs h-9 px-3"
                  >
                    Keep This
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerate}
                  disabled={loading}
                  className="text-xs h-9 px-3"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Regenerate
                </Button>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={loading}
              className="text-xs h-9 px-4 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              {isNutrition ? (
                <>
                  <FileText className="w-3.5 h-3.5 mr-1.5" /> Save Draft
                </>
              ) : (
                <>
                  <Target className="w-3.5 h-3.5 mr-1.5" /> Save & Assign
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Should not reach here
  return null;
}

function SectionHeader({ children, icon: Icon }) {
  return (
    <div className="flex items-center gap-2 text-[12px] uppercase tracking-wider font-semibold text-primary">
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      {children}
    </div>
  );
}