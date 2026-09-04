import React, { useState, useMemo } from 'react';
import { Button, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertCircle, Save, Send } from 'lucide-react';

/**
 * Client-facing form filler.
 * Renders questions from questions_snapshot and handles response input.
 */
export default function FormFiller({ assessment, onSave, onSubmit, onClose }) {
  const questions = useMemo(() => {
    const qs = assessment?.questions_snapshot || [];
    return [...qs].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [assessment]);

  const isSubmitted = assessment?.submission_status === 'submitted' || assessment?.submission_status === 'reviewed';

  // Initialize responses from existing assessment_responses
  const [responses, setResponses] = useState(() => {
    const map = {};
    (assessment?.assessment_responses || []).forEach((r) => {
      map[r.question_id] = r.response_value;
    });
    // Ensure every question has an entry
    questions.forEach((q) => {
      if (!(q.id in map)) {
        map[q.id] = q.question_type === 'multiple_choice' ? [] : '';
      }
    });
    return map;
  });

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [saveMessage, setSaveMessage] = useState('');

  const updateResponse = (questionId, value) => {
    if (isSubmitted) return;
    setResponses((prev) => ({ ...prev, [questionId]: value }));
    // Clear validation error on change
    if (validationErrors[questionId]) {
      setValidationErrors((prev) => {
        const copy = { ...prev };
        delete copy[questionId];
        return copy;
      });
    }
  };

  const buildResponseRecords = () => {
    return questions.map((q) => ({
      question_id: q.id,
      question_label: q.label,
      response_value: responses[q.id] != null ? responses[q.id] : '',
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage('');
    try {
      await onSave(assessment.id, buildResponseRecords());
      setSaveMessage('Progress saved');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      console.error(err);
      setSaveMessage('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const validate = () => {
    const errs = {};
    questions.forEach((q) => {
      if (!q.required) return;
      const val = responses[q.id];
      if (val === undefined || val === null || val === '') {
        errs[q.id] = 'This field is required';
      } else if (Array.isArray(val) && val.length === 0) {
        errs[q.id] = 'Please select at least one option';
      }
    });
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onSubmit(assessment.id, buildResponseRecords());
      onClose();
    } catch (err) {
      console.error(err);
      setValidationErrors({ _form: err.message || 'Submission failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-6 pb-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-[15px] font-display font-semibold text-foreground">{assessment?.name || 'Form'}</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">{questions.length} questions</p>
          </div>
          <div className="flex items-center gap-2">
            {isSubmitted && (
              <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" /> Submitted
              </Badge>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
          </div>
        </div>

        {/* Questions */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {validationErrors._form && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {validationErrors._form}
            </div>
          )}

          {questions.map((q, idx) => (
            <div key={q.id} className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-[11px] font-medium text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded mt-0.5">
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-foreground">
                    {q.label}
                    {q.required && <span className="text-red-400 ml-1">*</span>}
                  </p>
                  {q.description && <p className="text-[11px] text-muted-foreground mt-0.5">{q.description}</p>}
                </div>
              </div>

              <div className="pl-7">
                <QuestionInput
                  question={q}
                  value={responses[q.id]}
                  onChange={(val) => updateResponse(q.id, val)}
                  disabled={isSubmitted}
                  error={validationErrors[q.id]}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {!isSubmitted && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving || submitting}>
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving…' : 'Save Progress'}
              </Button>
              {saveMessage && (
                <span className="text-[11px] text-emerald-400">{saveMessage}</span>
              )}
            </div>
            <Button onClick={handleSubmit} disabled={saving || submitting}>
              <Send className="w-3.5 h-3.5" />
              {submitting ? 'Submitting…' : 'Submit Form'}
            </Button>
          </div>
        )}

        {isSubmitted && (
          <div className="px-5 py-4 border-t border-border shrink-0 text-center">
            <p className="text-[13px] text-muted-foreground">This form has been submitted. Your plan will be ready within 3–7 days.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Renders the appropriate input control per question type.
 */
function QuestionInput({ question, value, onChange, disabled, error }) {
  const { question_type, options } = question;
  const baseInput = 'w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-60';
  const errorBorder = error ? 'border-red-500/40' : '';

  const renderInput = () => {
    switch (question_type) {
      case 'short_answer':
        return <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="Your answer…" className={cn(baseInput, errorBorder)} />;

      case 'long_answer':
        return <textarea rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="Your answer…"
          className={cn('w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 transition-colors resize-none disabled:opacity-60', errorBorder)} />;

      case 'single_choice':
        return (
          <div className="space-y-2">
            {(options || []).map((opt, i) => (
              <label key={i} className={cn('flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors', disabled && 'opacity-60',
                value === opt ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-border')}>
                <input type="radio" name={`q_${question.id}`} checked={value === opt} onChange={() => onChange(opt)} disabled={disabled}
                  className="accent-primary" />
                <span className="text-[13px]">{opt}</span>
              </label>
            ))}
          </div>
        );

      case 'multiple_choice':
        const arrVal = Array.isArray(value) ? value : [];
        return (
          <div className="space-y-2">
            {(options || []).map((opt, i) => (
              <label key={i} className={cn('flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors', disabled && 'opacity-60',
                arrVal.includes(opt) ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-border')}>
                <input type="checkbox" checked={arrVal.includes(opt)} disabled={disabled}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...arrVal, opt]);
                    else onChange(arrVal.filter(v => v !== opt));
                  }}
                  className="accent-primary" />
                <span className="text-[13px]">{opt}</span>
              </label>
            ))}
          </div>
        );

      case 'yes_no':
        return (
          <div className="flex gap-3">
            {['Yes', 'No'].map((opt) => (
              <button key={opt} type="button" disabled={disabled}
                onClick={() => onChange(opt)}
                className={cn('flex-1 h-10 rounded-lg border text-[13px] font-medium transition-all',
                  value === opt ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-border hover:text-foreground',
                  disabled && 'opacity-60')}>
                {opt}
              </button>
            ))}
          </div>
        );

      case 'dropdown':
        return (
          <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}
            className={cn(baseInput, errorBorder)}>
            <option value="">Select…</option>
            {(options || []).map((opt, i) => (
              <option key={i} value={opt}>{opt}</option>
            ))}
          </select>
        );

      case 'number':
        return <input type="number" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="0" className={cn(baseInput, errorBorder)} />;

      case 'date':
        return <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cn(baseInput, errorBorder)} />;

      case 'time':
        return <input type="time" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cn(baseInput, errorBorder)} />;

      case 'rating':
        const numVal = parseInt(value) || 0;
        return (
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" disabled={disabled}
                onClick={() => onChange(n)}
                className={cn('w-10 h-10 rounded-lg border text-[14px] font-semibold transition-all',
                  numVal >= n ? 'border-amber-400/50 bg-amber-500/15 text-amber-400' : 'border-border text-muted-foreground hover:text-foreground',
                  disabled && 'opacity-60')}>
                {n}
              </button>
            ))}
          </div>
        );

      case 'file_upload':
      case 'image_upload':
        return (
          <div className={cn('p-4 rounded-lg border border-dashed text-center', errorBorder || 'border-border/50')}>
            <p className="text-[12px] text-muted-foreground">File upload coming soon</p>
          </div>
        );

      default:
        return <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="Your answer…" className={cn(baseInput, errorBorder)} />;
    }
  };

  return (
    <div>
      {renderInput()}
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
