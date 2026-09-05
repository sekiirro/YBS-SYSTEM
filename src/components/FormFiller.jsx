import React, { useState, useMemo } from 'react';
import { Button, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertCircle, Save, Send, Smartphone } from 'lucide-react';

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
      response_value: (q.question_type === 'file_upload' || q.question_type === 'image_upload')
        ? (responses[q.id] || 'يتم الإرسال على رقم المتابعة')
        : (responses[q.id] != null ? responses[q.id] : ''),
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
      // file_upload and image_upload are handled via direct follow-up communication, never block submission
      if (q.question_type === 'file_upload' || q.question_type === 'image_upload') return;
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

          {questions.map((q, idx) => {
            const currentSection = q.conditional_rules?.section;
            const prevSection = idx > 0 ? questions[idx - 1]?.conditional_rules?.section : null;
            const isNewSection = currentSection && currentSection !== prevSection;

            return (
              <React.Fragment key={q.id}>
                {isNewSection && (
                  <div className={cn("pt-4 pb-2 border-b border-border/60 mb-3", idx > 0 && "mt-6")}>
                    <h3 className="text-sm font-semibold text-primary font-display flex items-center gap-2" dir="auto">
                      <span className="w-1.5 h-4 rounded-full bg-primary inline-block" />
                      {currentSection}
                    </h3>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded mt-0.5 shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground" dir="auto">
                        {q.label}
                        {q.required && <span className="text-red-400 ml-1">*</span>}
                      </p>
                      {q.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5" dir="auto">
                          {q.description}
                        </p>
                      )}
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
              </React.Fragment>
            );
          })}
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
 * Generates natural Arabic instructions for file/image questions directing
 * the client to send the asset to their follow-up number (رقم المتابعة).
 */
function getUploadInstruction(question) {
  const text = `${question?.label || ''} ${question?.description || ''}`.toLowerCase();

  // InBody
  if (text.includes('inbody') || text.includes('إنبادي') || text.includes('انبودي') || text.includes('ان بادي') || text.includes('إن بادي')) {
    return {
      title: 'إرسال تقرير الـInBody:',
      instruction: 'برجاء إرسال صورة واضحة أو ملف التقرير على رقم المتابعة الخاص بك.',
    };
  }

  // Progress photos
  if (text.includes('progress') || (text.includes('صور') && (text.includes('تقدم') || text.includes('البداية') || text.includes('بداية') || text.includes('جسم') || text.includes('شكل')))) {
    return {
      title: 'إرسال صور التقدم:',
      instruction: 'برجاء إرسال صور التقدم المطلوبة على رقم المتابعة الخاص بك.',
    };
  }

  // Gym / Equipment
  if (text.includes('جيم') || text.includes('gym') || text.includes('معدات') || text.includes('أجهزة') || text.includes('اجهزة')) {
    return {
      title: 'إرسال صور/فيديو الجيم:',
      instruction: 'برجاء إرسال صور أو فيديو لمعدات الجيم المتاحة لديك على رقم المتابعة الخاص بك.',
    };
  }

  // Workout plan
  if (text.includes('برنامج') || text.includes('تمرين') || text.includes('split') || text.includes('workout')) {
    return {
      title: 'إرسال برنامج التمرين:',
      instruction: 'برجاء إرسال صورة أو ملف برنامج التمرين الحالي على رقم المتابعة الخاص بك.',
    };
  }

  // General image vs general file
  const isImage = question?.question_type === 'image_upload' || text.includes('صورة') || text.includes('صور');
  return {
    title: isImage ? 'إرسال الصورة:' : 'إرسال الملف:',
    instruction: isImage
      ? 'برجاء إرسال الصورة المطلوبة على رقم المتابعة الخاص بك.'
      : 'برجاء إرسال الملف المطلوب على رقم المتابعة الخاص بك.',
  };
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
        return (
          <input
            type="text"
            dir="auto"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder="Your answer…"
            className={cn(baseInput, errorBorder)}
          />
        );

      case 'long_answer':
        return (
          <textarea
            rows={3}
            dir="auto"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder="Your answer…"
            className={cn('w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 transition-colors resize-none disabled:opacity-60', errorBorder)}
          />
        );

      case 'single_choice':
        return (
          <div className="space-y-2">
            {(options || []).map((opt, i) => (
              <label
                key={i}
                className={cn(
                  'flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors',
                  disabled && 'opacity-60',
                  value === opt ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-border'
                )}
              >
                <input
                  type="radio"
                  name={`q_${question.id}`}
                  checked={value === opt}
                  onChange={() => onChange(opt)}
                  disabled={disabled}
                  className="accent-primary shrink-0"
                />
                <span className="text-[13px]" dir="auto">{opt}</span>
              </label>
            ))}
          </div>
        );

      case 'multiple_choice':
        const arrVal = Array.isArray(value) ? value : [];
        return (
          <div className="space-y-2">
            {(options || []).map((opt, i) => (
              <label
                key={i}
                className={cn(
                  'flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors',
                  disabled && 'opacity-60',
                  arrVal.includes(opt) ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-border'
                )}
              >
                <input
                  type="checkbox"
                  checked={arrVal.includes(opt)}
                  disabled={disabled}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...arrVal, opt]);
                    else onChange(arrVal.filter(v => v !== opt));
                  }}
                  className="accent-primary shrink-0"
                />
                <span className="text-[13px]" dir="auto">{opt}</span>
              </label>
            ))}
          </div>
        );

      case 'yes_no':
        const yesNoOptions = (options && options.length > 0) ? options : ['Yes', 'No'];
        return (
          <div className="flex gap-3">
            {yesNoOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                disabled={disabled}
                onClick={() => onChange(opt)}
                className={cn(
                  'flex-1 h-10 rounded-lg border text-[13px] font-medium transition-all',
                  value === opt ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-border hover:text-foreground',
                  disabled && 'opacity-60'
                )}
                dir="auto"
              >
                {opt}
              </button>
            ))}
          </div>
        );

      case 'dropdown':
        return (
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            dir="auto"
            className={cn(baseInput, errorBorder)}
          >
            <option value="">Select…</option>
            {(options || []).map((opt, i) => (
              <option key={i} value={opt} dir="auto">{opt}</option>
            ))}
          </select>
        );

      case 'number':
        return (
          <input
            type="number"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder="0"
            className={cn(baseInput, errorBorder)}
          />
        );

      case 'date':
        return (
          <input
            type="date"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={cn(baseInput, errorBorder)}
          />
        );

      case 'time':
        return (
          <input
            type="time"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={cn(baseInput, errorBorder)}
          />
        );

      case 'rating':
        const numVal = parseInt(value) || 0;
        const scaleItems = (options && options.length >= 5)
          ? options
          : [1, 2, 3, 4, 5];
        return (
          <div className="flex flex-wrap gap-1.5">
            {scaleItems.map((n, i) => {
              const valNum = typeof n === 'number' ? n : (parseInt(n) || (i + 1));
              const isSelected = value === n || value === String(n) || numVal === valNum;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(n)}
                  className={cn(
                    'min-w-9 h-9 px-2 rounded-lg border text-[13px] font-semibold transition-all',
                    isSelected ? 'border-amber-400/50 bg-amber-500/15 text-amber-400' : 'border-border text-muted-foreground hover:text-foreground',
                    disabled && 'opacity-60'
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
        );

      case 'file_upload':
      case 'image_upload':
        const { title, instruction } = getUploadInstruction(question);
        return (
          <div className="p-4 rounded-xl border border-primary/25 bg-primary/5 space-y-2 transition-all">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary shrink-0" />
              <p className="text-[13px] font-semibold text-primary" dir="auto">
                {title}
              </p>
            </div>
            <p className="text-[12px] text-foreground/90 leading-relaxed pr-1" dir="auto">
              {instruction.replace('رقم المتابعة الخاص بك.', '')}
              <strong className="text-foreground font-bold">رقم المتابعة الخاص بك</strong>.
            </p>
            <div className="pt-0.5">
              <span className="inline-flex items-center text-[11px] text-muted-foreground bg-secondary/80 px-2.5 py-0.5 rounded-full border border-border/40" dir="auto">
                يتم الإرسال عبر قنوات المتابعة المباشرة — لا يتطلب رفع ملف هنا
              </span>
            </div>
          </div>
        );

      default:
        return (
          <input
            type="text"
            dir="auto"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder="Your answer…"
            className={cn(baseInput, errorBorder)}
          />
        );
    }
  };

  return (
    <div>
      {renderInput()}
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
