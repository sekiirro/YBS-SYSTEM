import React, { useState, useCallback } from 'react';
import { Modal, Button, Input, TextArea, Select, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, GripVertical, ChevronUp, ChevronDown,
  Type, AlignLeft, CircleDot, CheckSquare, ToggleLeft,
  List, Hash, Calendar, Star, Upload, Image, Clock, Copy
} from 'lucide-react';

const QUESTION_TYPES = [
  { value: 'short_answer', label: 'Short Answer', icon: Type },
  { value: 'long_answer', label: 'Long Answer', icon: AlignLeft },
  { value: 'single_choice', label: 'Single Choice (MCQ)', icon: CircleDot },
  { value: 'multiple_choice', label: 'Multiple Choice (Checkbox)', icon: CheckSquare },
  { value: 'yes_no', label: 'Yes / No', icon: ToggleLeft },
  { value: 'dropdown', label: 'Dropdown', icon: List },
  { value: 'number', label: 'Number', icon: Hash },
  { value: 'date', label: 'Date', icon: Calendar },
  { value: 'rating', label: 'Rating (1–5)', icon: Star },
  { value: 'file_upload', label: 'File Upload', icon: Upload },
  { value: 'image_upload', label: 'Image Upload', icon: Image },
  { value: 'time', label: 'Time', icon: Clock },
];

const TYPES_WITH_OPTIONS = ['single_choice', 'multiple_choice', 'dropdown'];

function newQuestion(sortOrder) {
  return {
    _key: crypto.randomUUID(),
    question_type: 'short_answer',
    label: '',
    description: '',
    required: false,
    options: [],
    sort_order: sortOrder,
  };
}

export default function FormBuilder({ open, onClose, onSave, initialData }) {
  const isEdit = !!initialData?.id;
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [status, setStatus] = useState(initialData?.status || 'draft');
  const [questions, setQuestions] = useState(() => {
    if (initialData?.assessment_questions?.length) {
      return initialData.assessment_questions.map((q) => ({ ...q, _key: q.id || crypto.randomUUID() }));
    }
    return [newQuestion(0)];
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const addQuestion = () => {
    setQuestions((prev) => [...prev, newQuestion(prev.length)]);
  };

  const duplicateQuestion = (index) => {
    const q = questions[index];
    const dup = { ...q, _key: crypto.randomUUID(), id: undefined, label: q.label + ' (copy)' };
    const updated = [...questions];
    updated.splice(index + 1, 0, dup);
    setQuestions(updated);
  };

  const removeQuestion = (index) => {
    if (questions.length <= 1) return;
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const updateQuestion = (index, field, value) => {
    setQuestions((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const moveQuestion = (index, direction) => {
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= questions.length) return;
    const updated = [...questions];
    [updated[index], updated[newIdx]] = [updated[newIdx], updated[index]];
    setQuestions(updated);
  };

  const addOption = (qIndex) => {
    const q = questions[qIndex];
    updateQuestion(qIndex, 'options', [...(q.options || []), '']);
  };

  const updateOption = (qIndex, optIndex, value) => {
    const opts = [...(questions[qIndex].options || [])];
    opts[optIndex] = value;
    updateQuestion(qIndex, 'options', opts);
  };

  const removeOption = (qIndex, optIndex) => {
    const opts = [...(questions[qIndex].options || [])];
    opts.splice(optIndex, 1);
    updateQuestion(qIndex, 'options', opts);
  };

  const validate = () => {
    const errs = {};
    if (!name.trim()) errs.name = 'Form name is required';
    questions.forEach((q, i) => {
      if (!q.label.trim()) errs[`q_${i}_label`] = 'Question text is required';
      if (TYPES_WITH_OPTIONS.includes(q.question_type) && (!q.options || q.options.filter(o => o.trim()).length < 2)) {
        errs[`q_${i}_options`] = 'At least 2 options are required';
      }
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (saveStatus) => {
    if (!validate()) return;
    setSaving(true);
    try {
      await onSave({
        id: initialData?.id,
        name: name.trim(),
        description: description.trim() || null,
        status: saveStatus,
        questions: questions.map((q, idx) => ({
          question_type: q.question_type,
          label: q.label.trim(),
          description: q.description?.trim() || null,
          required: q.required,
          options: TYPES_WITH_OPTIONS.includes(q.question_type) ? (q.options || []).filter(o => o.trim()) : [],
          sort_order: idx,
        })),
      });
      onClose();
    } catch (err) {
      console.error('Save failed:', err);
      setErrors({ save: err.message || 'Failed to save form' });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-8 pb-8">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-[15px] font-display font-semibold text-foreground">
            {isEdit ? 'Edit Form' : 'New Form'}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {errors.save && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">{errors.save}</div>
          )}

          {/* Form metadata */}
          <div className="space-y-3">
            <Input
              label="Form Name *"
              placeholder="e.g. Initial Assessment, Weekly Check-in"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
            />
            <TextArea
              label="Description"
              placeholder="Brief description of this form…"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Questions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-foreground">Questions ({questions.length})</h3>
              <Button variant="outline" size="sm" onClick={addQuestion}>
                <Plus className="w-3.5 h-3.5" /> Add Question
              </Button>
            </div>

            {questions.map((q, idx) => {
              const TypeIcon = QUESTION_TYPES.find(t => t.value === q.question_type)?.icon || Type;
              return (
                <div key={q._key} className="surface-card p-4 space-y-3 border border-border/70">
                  {/* Question header */}
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-0.5 pt-1">
                      <button onClick={() => moveQuestion(idx, -1)} disabled={idx === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => moveQuestion(idx, 1)} disabled={idx === questions.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded">
                          Q{idx + 1}
                        </span>
                        <TypeIcon className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                      <input
                        type="text"
                        placeholder="Enter question text…"
                        value={q.label}
                        onChange={(e) => updateQuestion(idx, 'label', e.target.value)}
                        className={cn(
                          'w-full h-9 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] text-foreground placeholder:text-muted-foreground/50',
                          'focus:outline-none focus:border-primary/40 transition-colors',
                          errors[`q_${idx}_label`] && 'border-red-500/40'
                        )}
                      />
                      {errors[`q_${idx}_label`] && <p className="text-[11px] text-red-400">{errors[`q_${idx}_label`]}</p>}

                      <input
                        type="text"
                        placeholder="Description (optional)"
                        value={q.description || ''}
                        onChange={(e) => updateQuestion(idx, 'description', e.target.value)}
                        className="w-full h-8 px-3 rounded-lg bg-secondary/30 border border-border/50 text-[12px] text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 transition-colors"
                      />
                    </div>

                    <div className="flex items-center gap-1 pt-1">
                      <button onClick={() => duplicateQuestion(idx)}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded transition-colors"
                        title="Duplicate">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeQuestion(idx)} disabled={questions.length <= 1}
                        className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-30"
                        title="Remove">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Question settings row */}
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={q.question_type}
                      onChange={(e) => updateQuestion(idx, 'question_type', e.target.value)}
                      className="h-8 px-2 rounded-lg bg-secondary/50 border border-border text-[12px] focus:outline-none focus:border-primary/40 transition-colors"
                    >
                      {QUESTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>

                    <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={q.required}
                        onChange={(e) => updateQuestion(idx, 'required', e.target.checked)}
                        className="accent-primary"
                      />
                      Required
                    </label>
                  </div>

                  {/* Options editor for choice/dropdown types */}
                  {TYPES_WITH_OPTIONS.includes(q.question_type) && (
                    <div className="space-y-2 pl-6">
                      <p className="text-[11px] font-medium text-muted-foreground">Options</p>
                      {(q.options || []).map((opt, optIdx) => (
                        <div key={optIdx} className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground/60 w-5 text-right">{optIdx + 1}.</span>
                          <input
                            type="text"
                            placeholder={`Option ${optIdx + 1}`}
                            value={opt}
                            onChange={(e) => updateOption(idx, optIdx, e.target.value)}
                            className="flex-1 h-8 px-3 rounded-lg bg-secondary/30 border border-border/50 text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 transition-colors"
                          />
                          <button onClick={() => removeOption(idx, optIdx)}
                            className="p-1 text-muted-foreground hover:text-red-400 transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <button onClick={() => addOption(idx)}
                        className="text-[12px] text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add Option
                      </button>
                      {errors[`q_${idx}_options`] && <p className="text-[11px] text-red-400">{errors[`q_${idx}_options`]}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => handleSave('draft')} disabled={saving}>
              {saving ? 'Saving…' : 'Save as Draft'}
            </Button>
            <Button onClick={() => handleSave('published')} disabled={saving}>
              {saving ? 'Saving…' : (isEdit ? 'Save & Publish' : 'Publish Form')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
