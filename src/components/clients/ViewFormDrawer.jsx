import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AssessmentsService } from '@/services/assessments';
import { formatDate, formatDateTime, getInitials } from '@/lib/ybs-utils';
import { Button } from '@/components/ui';
import { toast } from '@/components/ui/use-toast';
import {
  X, CheckCircle2, Printer, Share2, CheckCheck,
  Building2, Calendar, FileText, ChevronDown,
  ChevronUp, ArrowRight, RefreshCw, FileUp,
  ExternalLink, AlertTriangle, Smartphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SECTION_COLORS = [
  { border: 'border-sky-500/20', bg: 'bg-sky-500/5', headerBg: 'bg-sky-500/10', text: 'text-sky-400', glow: 'hover:shadow-[0_0_20px_rgba(14,165,233,0.06)]' },
  { border: 'border-violet-500/20', bg: 'bg-violet-500/5', headerBg: 'bg-violet-500/10', text: 'text-violet-400', glow: 'hover:shadow-[0_0_20px_rgba(139,92,246,0.06)]' },
  { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', headerBg: 'bg-emerald-500/10', text: 'text-emerald-400', glow: 'hover:shadow-[0_0_20px_rgba(16,185,129,0.06)]' },
  { border: 'border-amber-500/20', bg: 'bg-amber-500/5', headerBg: 'bg-amber-500/10', text: 'text-amber-400', glow: 'hover:shadow-[0_0_20px_rgba(245,158,11,0.06)]' },
  { border: 'border-rose-500/20', bg: 'bg-rose-500/5', headerBg: 'bg-rose-500/10', text: 'text-rose-400', glow: 'hover:shadow-[0_0_20px_rgba(244,63,94,0.06)]' },
];

// ─── Answer helpers ───────────────────────────────────────────────

// A real response row carries answer fields; the list-view embed shape
// (`assessment_responses: [{ count: N }]`) is only an aggregate.
const isRealResponseRow = (r) => !!r && r && ('response_value' in r || 'question_id' in r);

const hasRealInlineResponses = (list) =>
  Array.isArray(list) && list.length > 0 && list.some(isRealResponseRow);

const isNotEmptyValue = (val) =>
  val !== null && val !== undefined && val !== '' && val !== '—' &&
  !(Array.isArray(val) && val.length === 0);

const toItems = (val) => {
  if (Array.isArray(val)) return val.filter((v) => v !== '' && v != null);
  if (val == null || val === '') return [];
  return String(val).split(/[,،]/).map((s) => s.trim()).filter(Boolean);
};

const YES_WORDS = ['yes', 'y', 'نعم', 'true', '1', 'أجل', 'صحيح', 'موافق'];
const NO_WORDS = ['no', 'n', 'لا', 'false', '0', 'غير', 'خطأ'];

const isUrlLike = (s) => /^(https?:\/\/|\/|data:)/i.test(String(s || '').trim());

/**
 * Renders one saved answer according to its question type. Returns the
 * formatted value (pill / badge / formatted date / readable text) or null
 * when nothing meaningful is saved.
 */
function AnswerValue({ question, val }) {
  const type = question.question_type;

  if (type === 'file_upload' || type === 'image_upload') {
    const s = String(val ?? '').trim();
    if (!s) return null;
    if (isUrlLike(s)) {
      return (
        <span className="inline-flex items-center gap-2 min-w-0" dir="ltr">
          <FileUp className="w-4 h-4 text-primary shrink-0" />
          <a href={s} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-[300px]">
            {s.split('/').pop() || s}
          </a>
          <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
        </span>
      );
    }
    return (
      <span className="inline-flex items-start gap-2 text-[12.5px]" dir="auto">
        <Smartphone className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <span className="leading-relaxed">{s}</span>
      </span>
    );
  }

  if (type === 'multiple_choice') {
    const items = toItems(val);
    if (items.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            dir="auto"
            className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-[12px] font-medium text-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    );
  }

  if (type === 'yes_no') {
    const raw = Array.isArray(val) ? val[0] : val;
    const txt = String(raw ?? '');
    const lower = txt.toLowerCase();
    const isYes = YES_WORDS.includes(lower);
    const isNo = NO_WORDS.includes(lower);
    return (
      <span className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold border',
        isYes
          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
          : isNo
            ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
            : 'bg-white/[0.06] text-foreground border-white/[0.1]'
      )}>
        {isYes && <CheckCircle2 className="w-3.5 h-3.5" />}
        {isNo && <X className="w-3.5 h-3.5" />}
        <span dir="auto">{txt}</span>
      </span>
    );
  }

  if (type === 'date') {
    const formatted = formatDate(String(val));
    return (
      <span className="inline-flex items-center gap-1.5 text-[14px] font-normal" dir="ltr">
        <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
        {formatted}
      </span>
    );
  }

  if (type === 'single_choice' || type === 'dropdown') {
    const item = Array.isArray(val) ? val[0] : val;
    const txt = String(item ?? '');
    return (
      <span
        dir="auto"
        className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-[12.5px] font-medium text-foreground"
      >
        {txt}
      </span>
    );
  }

  const txt = Array.isArray(val) ? val.join(', ') : String(val ?? '');
  if (type === 'long_answer' || txt.length > 50) {
    return (
      <p dir="auto" className="whitespace-pre-line break-words text-[14px] font-normal leading-relaxed">
        {txt}
      </p>
    );
  }
  return <span dir="auto" className="text-[14px] font-normal">{txt}</span>;
}

function SubmissionSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-white/[0.08] bg-[#0d1322]/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-4 w-40 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-3 w-16 rounded bg-white/[0.05] animate-pulse" />
          </div>
          {[0, 1].map((j) => (
            <div key={j} className="space-y-2">
              <div className="h-3 w-2/3 rounded bg-white/[0.05] animate-pulse" />
              <div className="h-9 w-full rounded-lg bg-white/[0.05] animate-pulse" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ViewFormDrawer({
  open,
  onClose,
  form,
  client,
  workspaceName,
  onMarkReviewed,
  canReview = true,
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadFlag, setReloadFlag] = useState(0);
  const [fullForm, setFullForm] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [marking, setMarking] = useState(false);

  // Load the specific submitted response for this form instance. The list
  // view embeds only a response COUNT aggregate (`[{count}]`), so whenever
  // the passed form does not carry real response rows we re-fetch the
  // assessment by id with `assessment_responses(*)`. Mock previews ship
  // their own inline responses and are used directly.
  useEffect(() => {
    if (!open || !form) {
      setFullForm(null);
      setLoadError('');
      return;
    }

    setLoadError('');

    if (hasRealInlineResponses(form.assessment_responses)) {
      setFullForm(form);
      return;
    }

    // Mock previews never have DB responses to fetch.
    if (String(form.id || '').startsWith('mock-')) {
      setFullForm(form);
      return;
    }

    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const data = await AssessmentsService.getById(form.id);
        if (alive) setFullForm(data);
      } catch (err) {
        console.warn('Could not fetch full responses for drawer:', err);
        if (!alive) return;
        setFullForm(form);
        setLoadError(err.message || 'Submission answers could not be loaded.');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [open, form, reloadFlag]);

  const retryLoad = () => setReloadFlag((n) => n + 1);

  const activeData = fullForm || form;

  // Group questions by section
  const { sections, totalQuestions, answeredCount, requiredCount, requiredAnsweredCount } = useMemo(() => {
    if (!activeData) return { sections: [], totalQuestions: 0, answeredCount: 0, requiredCount: 0, requiredAnsweredCount: 0 };

    const questions = [...(activeData.questions_snapshot || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const responses = activeData.assessment_responses || [];

    const sectionMap = new Map();
    let answered = 0;
    let reqTotal = 0;
    let reqAnswered = 0;

    questions.forEach((q, idx) => {
      // The id key can be `id` (snapshot) or `question_id` (client row).
      const qid = q.id || q.question_id;
      const resp = responses.find((r) => (r.question_id ?? r.id) === qid);
      const val = resp?.response_value;
      const hasValue = isNotEmptyValue(val);
      if (hasValue) answered++;
      if (q.required) {
        reqTotal++;
        if (hasValue) reqAnswered++;
      }

      const rawSection = q.conditional_rules?.section || 'General Information';
      if (!sectionMap.has(rawSection)) {
        sectionMap.set(rawSection, []);
      }
      sectionMap.get(rawSection).push({
        question: q,
        val,
        hasValue,
        index: idx + 1,
      });
    });

    const secList = Array.from(sectionMap.entries()).map(([title, items]) => ({
      title,
      items,
    }));

    return {
      sections: secList,
      totalQuestions: questions.length,
      answeredCount: answered,
      requiredCount: reqTotal,
      requiredAnsweredCount: reqAnswered,
    };
  }, [activeData]);

  // "100% completed" only when every required question is answered;
  // otherwise show the real completion percentage (floored so a fractional
  // rounding can never fake a 100%).
  const rawPct = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 100;
  const allRequiredAnswered = requiredCount === 0 || requiredAnsweredCount === requiredCount;
  const completionPct = allRequiredAnswered ? Math.round(rawPct) : Math.floor(rawPct);
  const isFullyComplete = completionPct >= 100 && allRequiredAnswered;

  const toggleSection = (sectionTitle) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionTitle]: !prev[sectionTitle] }));
  };

  const handlePrint = () => {
    window.print();
  };

  const handleShare = () => {
    const summaryText = `YBS Form: ${activeData?.name || 'Form'}\nClient: ${client?.full_name || 'Client'} (${client?.client_code || '—'})\nStatus: ${activeData?.submission_status || 'submitted'}\nSubmitted: ${formatDateTime(activeData?.submitted_at)}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(summaryText);
      toast({
        title: 'Form Details Copied',
        description: 'Formatted summary copied to clipboard to share with trainers.',
      });
    }
  };

  const handleMarkAsReviewed = async () => {
    if (!activeData?.id || marking) return;
    try {
      setMarking(true);
      const nowIso = new Date().toISOString();

      // Only attempt server call for real UUIDs
      if (!String(activeData.id).startsWith('mock-')) {
        await AssessmentsService.update(activeData.id, {
          submission_status: 'reviewed',
          reviewed_at: nowIso,
        });
      }

      setFullForm((prev) => ({
        ...prev,
        submission_status: 'reviewed',
        reviewed_at: nowIso,
      }));

      if (onMarkReviewed) {
        onMarkReviewed(activeData.id);
      }

      toast({
        title: 'Form Marked as Reviewed',
        description: 'Status updated immediately. The unread notification dot has been cleared.',
      });
    } catch (err) {
      console.error('Failed to mark form as reviewed:', err);
      toast({
        title: 'Update Failed',
        description: err.message || 'Could not update form status.',
        variant: 'destructive',
      });
    } finally {
      setMarking(false);
    }
  };

  if (!open || !form) return null;

  const isReviewed = activeData?.submission_status === 'reviewed' || !!activeData?.reviewed_at;
  const isSubmittedForm = activeData?.submission_status === 'submitted' || isReviewed;

  // A submitted form with questions but zero saved answers means the real
  // response could not be surfaced — never silently show a blank template.
  const showMissingAnswers = !loading && isSubmittedForm && totalQuestions > 0 && answeredCount === 0;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden print:static print:overflow-visible">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm print:hidden"
        />

        {/* Slide-over Drawer panel: Full-screen on mobile/small-tablet, max-w-2xl on desktop */}
        <div className="fixed inset-y-0 right-0 w-full sm:max-w-2xl flex pl-0 sm:pl-6 print:static print:pl-0 print:block">
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="w-full bg-[#0b0f19] border-l border-white/[0.08] shadow-2xl flex flex-col h-full print:w-full print:max-w-none print:border-0 print:bg-white print:text-black"
          >
            {/* Top Bar / Header */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-primary/20 flex items-center justify-between shrink-0 bg-gradient-to-b from-[#11192e] to-[#0d1322] shadow-[0_4px_24px_rgba(0,0,0,0.2)] z-10 print:bg-transparent print:border-b-2 print:border-black print:shadow-none">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-primary/20 border border-primary/30 shadow-[0_0_12px_rgba(59,130,246,0.2)] flex items-center justify-center text-primary font-bold text-xs sm:text-sm shrink-0 print:border-black print:shadow-none">
                  {getInitials(client?.full_name)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <h2 className="text-sm sm:text-base font-semibold text-foreground truncate print:text-black">
                      {client?.full_name}
                    </h2>
                    <span className="text-[12px] sm:text-[12px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-muted-foreground border border-white/[0.08] print:text-black print:border-gray-300">
                      {client?.client_code}
                    </span>
                    {workspaceName && (
                      <span className="text-[12px] sm:text-[12px] text-muted-foreground flex items-center gap-1 print:text-black">
                        <Building2 className="w-3 h-3 text-primary/70" />
                        {workspaceName}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] sm:text-[12px] text-muted-foreground mt-0.5 truncate print:text-black">
                    {client?.email || client?.phone || 'No direct contact'}
                  </p>
                </div>
              </div>

              {/* Status Indicator & Close */}
              <div className="flex items-center gap-2 shrink-0 print:hidden">
                {/* Always show emerald Submitted pill as primary status */}
                <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Submitted
                </span>

                {/* Subtle secondary reviewed indicator */}
                {isReviewed && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium tracking-wide bg-sky-500/10 text-sky-200/80 border border-sky-500/20 shadow-[0_0_10px_rgba(14,165,233,0.1)]"
                    title={`Reviewed on ${formatDate(activeData?.reviewed_at)}`}
                  >
                    <CheckCheck className="w-3 h-3 text-sky-400" />
                    <span className="hidden sm:inline">Reviewed</span>
                  </span>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Close drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sub-Header: Form Title, Completion Meter, Activity Bar */}
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[#090d16]/80 border-b border-white/[0.04] shrink-0 print:bg-transparent print:border-b">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground print:text-black truncate">
                      {activeData?.name || 'Client Assessment Form'}
                    </h3>
                  </div>
                  <p className="text-[12px] sm:text-[12px] text-muted-foreground mt-0.5 print:text-gray-600">
                    Submitted on {formatDateTime(activeData?.submitted_at)}
                  </p>
                </div>

                {/* Completion Indicator */}
                <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5 rounded-lg shrink-0 print:border-gray-300">
                  <div className="flex flex-col text-right">
                    <span className="text-[12px] font-semibold text-emerald-400 print:text-black">
                      {isFullyComplete ? '100% completed' : `${completionPct}% completed`}
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {answeredCount} of {totalQuestions} answered
                    </span>
                  </div>
                  <div className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>

              {/* Activity Timeline Bar */}
              <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between text-[12px] text-muted-foreground overflow-x-auto pb-1 print:hidden">
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span className="font-medium text-foreground">Form Sent</span>
                  <span className="text-muted-foreground text-[12px]">({formatDate(activeData?.created_at)})</span>
                </div>
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mx-1" />

                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-2 h-2 rounded-full bg-amber-400/80" />
                  <span>Reminder</span>
                  <span className="text-muted-foreground text-[12px]">Auto</span>
                </div>
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mx-1" />

                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-semibold text-emerald-400">Submitted</span>
                  <span className="text-emerald-400/70 text-[12px]">({formatDate(activeData?.submitted_at)})</span>
                </div>
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mx-1" />

                <div className="flex items-center gap-1.5 shrink-0">
                  <div className={cn('w-2 h-2 rounded-full', isReviewed ? 'bg-sky-400' : 'bg-muted-foreground/40')} />
                  <span className={cn(isReviewed ? 'text-slate-300 font-semibold' : 'text-muted-foreground')}>
                    {isReviewed ? `Reviewed (${formatDate(activeData?.reviewed_at)})` : 'Pending Review'}
                  </span>
                </div>
              </div>
            </div>

            {/* Content: Grouped Answer Sections */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6 print:overflow-visible print:p-0 print:space-y-4">
              {loading ? (
                <SubmissionSkeleton />
              ) : (loadError || showMissingAnswers) ? (
                <div className="py-12 text-center text-sm flex flex-col items-center justify-center gap-3 print:hidden">
                  <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <p className="text-foreground font-semibold">Submission answers could not be loaded</p>
                  <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                    {loadError
                      ? 'The submitted response for this client could not be retrieved.'
                      : 'This form is marked as submitted but no saved answers were found for this client.'}
                  </p>
                  <Button size="sm" variant="secondary" onClick={retryLoad} className="gap-1.5 text-xs">
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </Button>
                </div>
              ) : sections.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  No responses recorded for this form.
                </div>
              ) : (
                sections.map((section, sIdx) => {
                  const isCollapsed = !!collapsedSections[section.title];
                  const theme = SECTION_COLORS[sIdx % SECTION_COLORS.length];

                  return (
                    <div
                      key={section.title || sIdx}
                      className={cn(
                        "rounded-xl border overflow-hidden transition-all duration-300 ease-out print:border-gray-300 print:bg-white",
                        theme.bg, theme.border, theme.glow
                      )}
                    >
                      {/* Section Card Header */}
                      <button
                        type="button"
                        onClick={() => toggleSection(section.title)}
                        className={cn(
                          "w-full px-4 py-3 border-b border-white/[0.04] flex items-center justify-between text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary print:bg-gray-100 print:border-gray-300",
                          theme.headerBg, "hover:bg-white/[0.04]"
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[12px] font-bold border border-white/[0.05]", theme.headerBg, theme.text)}>
                            {sIdx + 1}
                          </div>
                          <span className={cn("text-[14px] font-semibold tracking-wide uppercase print:text-black", theme.text)} dir="auto">
                            {section.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground text-[12px] print:hidden">
                          <span>{section.items.length} questions</span>
                          {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </div>
                      </button>

                      {/* Section Answers List */}
                      {!isCollapsed && (
                        <div className="p-3.5 sm:p-4 space-y-3.5 divide-y divide-white/[0.04]">
                          {section.items.map(({ question, val, hasValue, index }) => {
                            const isEmptyRequired = !hasValue && question.required;
                            const isEmptyOptional = !hasValue && !question.required;

                            return (
                              <div
                                key={question.id || question.question_id || index}
                                className={cn(
                                  'pt-3 first:pt-0 space-y-1.5 transition-opacity',
                                  !hasValue && 'opacity-80 hover:opacity-100'
                                )}
                              >
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="text-[12px] font-medium text-muted-foreground flex items-center gap-1.5 print:text-gray-700" dir="auto">
                                    <span className="text-primary/70 font-mono text-[12px]">#{index}</span>
                                    <span>{question.label}</span>
                                    {question.required && (
                                      <span className="text-red-400 text-[12px]">*</span>
                                    )}
                                  </p>
                                  {question.description && (
                                    <span className="text-[12px] text-muted-foreground print:hidden truncate max-w-[200px]">
                                      {question.description}
                                    </span>
                                  )}
                                </div>

                                {isEmptyRequired ? (
                                  <div className="rounded-lg px-3.5 py-2.5 text-[12px] flex items-center gap-2 border border-amber-500/25 bg-amber-500/5 text-amber-300/90 italic print:border-gray-300 print:text-gray-700">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    <span dir="auto">No answer provided for this required question.</span>
                                  </div>
                                ) : isEmptyOptional ? (
                                  <div className="rounded-lg px-3.5 py-2.5 text-[12.5px] italic border border-dashed border-white/[0.05] bg-white/[0.02] text-muted-foreground print:border-gray-300 print:text-gray-500">
                                    Not provided
                                  </div>
                                ) : (
                                  <div className={cn(
                                    'rounded-lg px-4 py-3 text-[14px] leading-relaxed transition-colors border',
                                    'bg-black/20 border-white/[0.04] text-foreground print:bg-gray-50 print:text-black print:border-gray-200'
                                  )}>
                                    <AnswerValue question={question} val={val} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Actions Footer */}
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-t border-white/[0.08] bg-[#0d1322] shrink-0 flex items-center justify-between gap-2.5 print:hidden">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrint}
                  className="gap-1.5 text-xs h-9"
                  aria-label="Print or download PDF"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Print / PDF</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShare}
                  className="gap-1.5 text-xs h-9"
                  aria-label="Share form with trainer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
              </div>

              <div className="flex items-center gap-2">
                {!isReviewed && canReview && (
                  <Button
                    size="sm"
                    onClick={handleMarkAsReviewed}
                    disabled={marking}
                    className="gap-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white h-9"
                    aria-label="Mark form as reviewed"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>{marking ? 'Saving…' : 'Mark as Reviewed'}</span>
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                  className="text-xs h-9 px-4"
                  aria-label="Close modal"
                >
                  Close
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </AnimatePresence>
  );
}