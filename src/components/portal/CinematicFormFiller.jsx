import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Send, Smartphone } from 'lucide-react';

const isEmpty = (value) => value == null || value === '' || (Array.isArray(value) && value.length === 0);

export default function CinematicFormFiller({ assessment, onSave, onSubmit, onClose }) {
  const questions = useMemo(() => [...(assessment?.questions_snapshot || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [assessment]);
  const initial = useMemo(() => {
    const values = {};
    (assessment?.assessment_responses || []).forEach((response) => { values[response.question_id] = response.response_value; });
    questions.forEach((question) => { if (!(question.id in values)) values[question.id] = question.question_type === 'multiple_choice' ? [] : ''; });
    return values;
  }, [assessment, questions]);
  const [responses, setResponses] = useState(initial);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const trackRef = useRef(null);
  const submitted = ['submitted', 'reviewed'].includes(assessment?.submission_status);
  const question = questions[index];

  useEffect(() => {
    trackRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [index]);

  const records = () => questions.map((item) => ({
    question_id: item.id,
    question_label: item.label,
    response_value: ['file_upload', 'image_upload'].includes(item.question_type)
      ? (responses[item.id] || 'يتم الإرسال على رقم المتابعة')
      : (responses[item.id] ?? ''),
  }));

  const fail = (message = 'من فضلك جاوب على السؤال الأول') => {
    setError(message); setShaking(false);
    requestAnimationFrame(() => setShaking(true));
    window.setTimeout(() => setShaking(false), 520);
  };

  const validCurrent = () => {
    if (submitted) return true;
    if (!question || ['file_upload', 'image_upload'].includes(question.question_type)) return true;
    const value = responses[question.id];
    if (isEmpty(value)) { fail(); return false; }
    if (question.question_type === 'number' && question.conditional_rules?.numeric_accept !== 'number_range' && Number.isNaN(Number(value))) {
      fail('من فضلك أدخل قيمة رقمية صحيحة'); return false;
    }
    return true;
  };

  const next = async () => {
    if (!validCurrent()) return;
    setError('');
    if (submitted) { setIndex((current) => Math.min(questions.length - 1, current + 1)); return; }
    setSaving(true);
    try {
      await onSave(assessment.id, records());
      if (index < questions.length - 1) setIndex((current) => current + 1);
      else {
        setSubmitting(true);
        await onSubmit(assessment.id, records());
      }
    } catch (saveError) {
      fail(saveError?.message || 'تعذر حفظ الإجابة. حاول مرة أخرى.');
    } finally { setSaving(false); setSubmitting(false); }
  };

  if (!question) return null;

  return <section className="forms-answer" dir="rtl">
    <button type="button" className="forms-answer__close" onClick={onClose} aria-label="العودة إلى النماذج"><ArrowRight /></button>
    <div className="forms-answer__progress" aria-label={`السؤال ${index + 1} من ${questions.length}`}><span style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>
    <div className="forms-answer__copy" ref={trackRef}>
      <p className="forms-answer__eyebrow">{assessment.name} · {index + 1} / {questions.length}</p>
      {questions.slice(Math.max(0, index - 2), index + 2).map((item) => {
        const itemIndex = questions.indexOf(item); const current = itemIndex === index;
        return <div key={item.id} data-current={current} className={`forms-answer__question ${current ? 'is-current' : itemIndex < index ? 'is-past' : 'is-next'}`}>
          <span>{String(itemIndex + 1).padStart(2, '0')}</span><h2>{item.label}</h2>{item.description && <p>{item.description}</p>}
        </div>;
      })}
    </div>
    <div className={`forms-answer__dock ${shaking ? 'is-invalid' : ''}`}>
      <QuestionControl question={question} value={responses[question.id]} disabled={submitted} onChange={(value) => { setResponses((current) => ({ ...current, [question.id]: value })); setError(''); }} onEnter={next} />
      <div className="forms-answer__dock-footer">
        <div>{error ? <span className="forms-answer__error">{error}</span> : <span>{saving ? 'جاري حفظ الإجابة…' : submitted ? 'إجابة محفوظة' : 'اضغط Enter أو التالي'}</span>}</div>
        <div className="forms-answer__controls">
          <button type="button" onClick={() => { setError(''); setIndex((current) => Math.max(0, current - 1)); }} disabled={index === 0} aria-label="السؤال السابق"><ArrowRight /></button>
          <button type="button" className="forms-answer__next" onClick={next} disabled={saving || submitting}>
            {index === questions.length - 1 && !submitted ? <><span>{submitting ? 'جاري الإرسال…' : 'إرسال النموذج'}</span><Send /></> : <><span>التالي</span><ArrowLeft /></>}
          </button>
        </div>
      </div>
    </div>
  </section>;
}

function QuestionControl({ question, value, onChange, onEnter, disabled }) {
  const options = question.options || [];
  const keyDown = (event) => { if (event.key === 'Enter' && !event.shiftKey && question.question_type !== 'long_answer') { event.preventDefault(); onEnter(); } };
  if (['single_choice', 'yes_no', 'dropdown', 'rating'].includes(question.question_type)) {
    const choices = question.question_type === 'yes_no' && !options.length ? ['نعم', 'لا'] : question.question_type === 'rating' && !options.length ? [1, 2, 3, 4, 5] : options;
    return <div className="forms-answer__choices">{choices.map((option) => <button type="button" key={String(option)} disabled={disabled} className={value === option || value === String(option) ? 'is-selected' : ''} onClick={() => onChange(option)}><span>{option}</span>{(value === option || value === String(option)) && <Check />}</button>)}</div>;
  }
  if (question.question_type === 'multiple_choice') {
    const selected = Array.isArray(value) ? value : [];
    return <div className="forms-answer__choices">{options.map((option) => { const active = selected.includes(option); return <button type="button" key={option} disabled={disabled} className={active ? 'is-selected' : ''} onClick={() => onChange(active ? selected.filter((entry) => entry !== option) : [...selected, option])}><span>{option}</span>{active && <Check />}</button>; })}</div>;
  }
  if (['file_upload', 'image_upload'].includes(question.question_type)) return <div className="forms-answer__upload"><Smartphone /><div><strong>أرسل الملف على رقم المتابعة الخاص بك</strong><span>لن تحتاج إلى رفعه هنا، ويمكنك المتابعة للسؤال التالي.</span></div><CheckCircle2 /></div>;
  if (question.question_type === 'long_answer') return <textarea autoFocus dir="auto" rows="4" value={value || ''} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder="اكتب إجابتك هنا…" />;
  return <input autoFocus dir="auto" type={question.question_type === 'date' ? 'date' : question.question_type === 'time' ? 'time' : question.question_type === 'number' && question.conditional_rules?.numeric_accept !== 'number_range' ? 'number' : 'text'} value={value || ''} disabled={disabled} onChange={(event) => onChange(event.target.value)} onKeyDown={keyDown} placeholder={question.question_type === 'number' ? 'اكتب القيمة…' : 'اكتب إجابتك هنا…'} />;
}
