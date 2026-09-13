import React, { useState, useEffect, useCallback } from 'react';
import { AssessmentsService } from '@/services/assessments';
import { LoadingState, Badge } from '@/components/ui';
import { formatDate, getFormStatusColor } from '@/lib/ybs-utils';
import { ClipboardList, CheckCircle2, Calendar, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Read-only view of a client's submitted onboarding/check-in form.
 *
 * Loads the client's assessments, filters to submitted/reviewed records, and
 * shows the latest submission grouped by section — the exact data the Gemini
 * analysis panels consume. Never allows edits.
 */
export default function FormSubmissionPanel({ clientId, initialId, className }) {
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState([]);
  const [selectedId, setSelectedId] = useState(initialId || null);
  const [assessment, setAssessment] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadForms = useCallback(async () => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const list = await AssessmentsService.list({ client_id: clientId });
      const submitted = (list || [])
        .filter((f) => f.submission_status === 'submitted' || f.submission_status === 'reviewed')
        .sort(
          (a, b) =>
            new Date(b.submitted_at || b.updated_at || b.created_at) -
            new Date(a.submitted_at || a.updated_at || a.created_at)
        );
      setForms(submitted);
      if (submitted.length > 0 && !selectedId) {
        setSelectedId(submitted[0].id);
      }
    } catch (err) {
      console.error('Error loading client form submissions:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId, selectedId]);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  useEffect(() => {
    if (!selectedId) {
      setAssessment(null);
      return;
    }
    let isMounted = true;
    setLoadingDetail(true);
    (async () => {
      try {
        const full = await AssessmentsService.getById(selectedId);
        if (isMounted) setAssessment(full);
      } catch (err) {
        console.error('Failed to load form submission:', err);
      } finally {
        if (isMounted) setLoadingDetail(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [selectedId]);

  if (loading) return <LoadingState label="Loading form submissions…" />;

  if (forms.length === 0) {
    return (
      <div className={cn('surface-card p-6 rounded-xl text-center border border-border/80', className)}>
        <div className="mx-auto w-12 h-12 rounded-2xl bg-secondary/60 border border-border/60 flex items-center justify-center mb-3">
          <ClipboardList className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-[13px] text-muted-foreground">
          Your client has not submitted the required form yet.
        </p>
      </div>
    );
  }

  const selected = forms.find((f) => f.id === selectedId) || forms[0];

  return (
    <div className={cn('space-y-4', className)}>
      {/* Submission Selector */}
      {forms.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {forms.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedId(f.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg border text-xs transition-colors flex items-center gap-1.5',
                selectedId === f.id
                  ? 'bg-primary/15 border-primary/40 text-primary font-semibold'
                  : 'bg-secondary/30 border-border/60 text-muted-foreground hover:text-foreground'
              )}
            >
              <FileText className="w-3 h-3" />
              <span className="max-w-40 truncate">{f.name}</span>
              <span className="text-[10px] opacity-80">{formatDate(f.submitted_at || f.updated_at)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Submission Detail */}
      <div className="surface-card rounded-xl border border-border/80 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-b border-border/60 bg-secondary/20">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList className="w-4 h-4 text-primary shrink-0" />
            <span className="text-[13px] font-semibold text-foreground truncate">{selected.name}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Badge className={cn('capitalize text-[10px]', getFormStatusColor(selected.submission_status))}>
              {selected.submission_status === 'submitted' ? 'Under Review' : 'Reviewed'}
            </Badge>
            {selected.submitted_at && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1 font-mono">
                <Calendar className="w-3 h-3" /> {formatDate(selected.submitted_at)}
              </span>
            )}
          </div>
        </div>

        {loadingDetail || !assessment ? (
          <div className="p-8 flex items-center justify-center">
            <LoadingState label="Loading submission…" />
          </div>
        ) : (
          <SubmissionAnswers assessment={assessment} />
        )}
      </div>
    </div>
  );
}

function SubmissionAnswers({ assessment }) {
  const questions = [...(assessment?.questions_snapshot || [])].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0)
  );
  const responseByQuestion = new Map(
    (assessment?.assessment_responses || []).map((r) => [r.question_id, r.response_value])
  );

  if (questions.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-xs text-muted-foreground">No questions in this form.</p>
      </div>
    );
  }

  const sections = [];
  let current = { name: null, questions: [] };
  questions.forEach((q, idx) => {
    const sectionName = q.conditional_rules?.section;
    if (sectionName && sectionName !== current.name) {
      if (current.questions.length > 0) sections.push(current);
      current = { name: sectionName, questions: [] };
    } else if (!sectionName && (current.name || current.questions.length > 0) && (idx === 0 || (questions[idx - 1]?.conditional_rules?.section && !sectionName))) {
      if (current.questions.length > 0) sections.push(current);
      current = { name: null, questions: [] };
    }
    current.questions.push(q);
  });
  if (current.questions.length > 0) sections.push(current);

  const renderAnswer = (q, raw) => {
    const values = formatAnswerValue(q, raw);
    if (!values || values.length === 0) {
      return (
        <div className="rounded-lg bg-secondary/30 border border-border/40 px-3 py-2 text-xs text-muted-foreground/70 italic">
          No answer
        </div>
      );
    }
    if (q.question_type === 'multiple_choice' && values.length > 1) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <span
              key={i}
              className="inline-flex items-center text-xs px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/25 text-foreground/90"
            >
              {v}
            </span>
          ))}
        </div>
      );
    }
    return (
      <div className="rounded-lg bg-secondary/30 border border-border/40 px-3 py-2.5 text-[13px] text-foreground/90 leading-relaxed whitespace-pre-wrap" dir="auto">
        {values.map((v, i) => (
          <span key={i}>{v}</span>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-5 space-y-6">
      {sections.map((sec, si) => (
        <div key={`${sec.name || 'general'}-${si}`} className="space-y-3">
          {sec.name && (
            <h4 className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5">
              <span className="w-1 h-3.5 rounded-full bg-primary inline-block" />
              {sec.name}
            </h4>
          )}
          <div className="space-y-3 pl-0.5">
            {sec.questions.map((q) => {
              const raw = responseByQuestion.get(q.id);
              return (
                <div key={q.id} className="space-y-1.5">
                  <p className="text-[13px] font-medium text-foreground" dir="auto">
                    {q.label}
                    {q.required && <span className="text-red-400 ml-1">*</span>}
                  </p>
                  {q.description && (
                    <p className="text-[11px] text-muted-foreground" dir="auto">{q.description}</p>
                  )}
                  {renderAnswer(q, raw)}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatAnswerValue(q, raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (Array.isArray(raw)) return raw.filter((v) => v !== '' && v != null);
  if (typeof raw === 'object') return [JSON.stringify(raw)];
  if (q.question_type === 'single_choice' && q.options?.includes(raw)) {
    return [<span key={raw}><CheckCircle2 className="w-3.5 h-3.5 inline mr-1 text-emerald-400" />{raw}</span>];
  }
  return [String(raw)];
}