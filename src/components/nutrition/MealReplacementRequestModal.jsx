import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Modal, Button, Badge } from '@/components/ui';
import { findFoodReplacements } from '@/services';
import { MealReplacementRequestsService } from '@/services/mealReplacementRequests';
import { cardItemVariants, listVariants, cardHover } from '@/lib/motion';
import {
  ArrowLeftRight,
  AlertCircle,
  Check,
  Info,
  SearchX,
  Send,
  Utensils,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const OTHER_HELPER_TEXT = 'مش مناسبني أي بديل، اقترحوا لي بدائل أكتر في الشات.';

const ROLE_LABELS = {
  lean_protein: 'Lean Protein',
  fatty_protein: 'Fatty Protein',
  plant_protein: 'Plant Protein',
  carb: 'Carb',
  high_fiber_carb: 'Fiber Carb',
  fruit: 'Fruit',
  vegetable: 'Vegetable',
  starchy_vegetable: 'Starchy Veg',
  fat_source: 'Fats & Oils',
  dairy: 'Dairy',
  mixed: 'Mixed',
};

function humanize(slug) {
  if (!slug) return '';
  return slug
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function roleLabel(slug) {
  return ROLE_LABELS[slug] || humanize(slug) || 'Unclassified';
}

function fmtMacro(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '0';
}

function MacroChip({ label, value, className = '' }) {
  return (
    <div className={cn('rounded-lg bg-background/60 border border-white/[0.06] px-2 py-1.5 text-center', className)}>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground/80 font-medium leading-tight">{label}</p>
      <p className="text-[12px] font-semibold text-foreground font-mono mt-0.5">{value}</p>
    </div>
  );
}

export default function MealReplacementRequestModal({
  open,
  onClose,
  meal,
  planId,
  workspaceId,
  clientId,
  requestedById,
  pendingRequests,
  onSubmitted,
}) {
  const items = meal?.items || meal?.nutrition_items || [];

  const [targetIndex, setTargetIndex] = useState(null);
  const [response, setResponse] = useState(null);
  const [status, setStatus] = useState('idle');
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const [choseOther, setChoseOther] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const existingPending = (pendingRequests || []).find((r) => r.meal_id === meal?.id);

  useEffect(() => {
    if (!open || !meal) return;
    // Start with a single-item meal already targeted; otherwise force a pick.
    const idx = items.length === 1 ? 0 : null;
    setTargetIndex(idx);
    setResponse(null);
    setStatus(idx === null ? 'idle' : 'loading');
    setSelectedCandidateId(null);
    setChoseOther(false);
    setReason('');
    setSubmitted(false);
    setSubmitError('');
  }, [open, meal]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetItem = targetIndex != null ? items[targetIndex] : null;

  // Compute read-only replacement candidates for the selected target item.
  // This is the SAME deterministic engine the trainer edit flow uses — nothing
  // is written to the plan; the output is merely offered as a request option.
  useEffect(() => {
    if (!open || !targetItem) return;
    let cancelled = false;
    setStatus('loading');
    setResponse(null);
    setSelectedCandidateId(null);
    setChoseOther(false);

    (async () => {
      try {
        const res = await findFoodReplacements({
          target: {
            calories: Number(targetItem.calories) || 0,
            protein: Number(targetItem.protein) || 0,
            carbs: Number(targetItem.carbs) || 0,
            fat: Number(targetItem.fat) || 0,
            amount: Number(targetItem.amount) > 0 ? Number(targetItem.amount) : null,
            unit: targetItem.unit || 'g',
            food_id: targetItem.food_id || null,
          },
          food: targetItem.base_food || null,
          workspaceId,
          excludedFoodIds: targetItem.food_id ? [targetItem.food_id] : [],
          limit: 6,
        });
        if (!cancelled) {
          setResponse(res);
          setStatus(res.status);
        }
      } catch (err) {
        console.error('Failed to compute meal replacement options:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, targetItem, workspaceId]);

  const results = response?.results || [];
  const canSubmit =
    !submitting &&
    !submitted &&
    reason.trim().length > 0 &&
    (choseOther || selectedCandidateId != null);

  const handlePickTarget = (idx) => setTargetIndex(idx);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError('');

    const candidate =
      !choseOther && selectedCandidateId != null
        ? results.find((r) => r.food_id === selectedCandidateId)
        : null;

    const payload = {
      workspace_id: workspaceId,
      client_id: clientId,
      nutrition_plan_id: planId,
      meal_id: meal.id,
      meal_name: meal.meal_name || 'Meal',
      request_type: choseOther ? 'other' : 'replacement',
      requested_by: requestedById,
      current_item_id: targetItem?.id || null,
      current_food_id: targetItem?.food_id || null,
      current_food_name: targetItem?.food_name || 'Food item',
      current_macros: {
        amount: targetItem?.amount || 0,
        unit: targetItem?.unit || 'g',
        calories: Number(targetItem?.calories) || 0,
        protein: Number(targetItem?.protein) || 0,
        carbs: Number(targetItem?.carbs) || 0,
        fat: Number(targetItem?.fat) || 0,
      },
      requested_food_id: candidate?.food_id || null,
      requested_food_name: candidate?.name || null,
      requested_replacement: candidate || null,
      reason: reason.trim(),
    };

    try {
      await MealReplacementRequestsService.create(payload);
      setSubmitted(true);
      if (onSubmitted) onSubmitted();
    } catch (err) {
      console.error('Failed to submit replacement request:', err);
      setSubmitError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Request a Replacement" size="lg">
      <div className="space-y-4">
        {/* Read-only framing */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-primary/[0.05] border border-primary/20 text-[12px] text-muted-foreground leading-relaxed">
          <Info className="w-4 h-4 shrink-0 text-primary mt-0.5" />
          <p>
            You're <strong className="text-foreground">requesting</strong> a swap — your coach reviews and applies it.
            Your plan is never changed directly from here.
          </p>
        </div>

        {/* Meal context */}
        <div className="rounded-xl border border-white/[0.08] bg-card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Utensils className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Meal</p>
            <h4 className="text-sm font-semibold text-foreground truncate">{meal?.meal_name || 'Meal'}</h4>
          </div>
        </div>

        {existingPending ? (
          <div className="flex items-start gap-2.5 p-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06]">
            <Info className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="text-[12px] text-muted-foreground leading-relaxed">
              <p className="font-semibold text-foreground">A request for this meal is already pending</p>
              <p className="mt-0.5">
                Your coach is reviewing it, so no duplicate request was created. You'll get an update in your
                notifications once it's approved or declined.
              </p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center border border-dashed border-border/60 rounded-xl text-xs text-muted-foreground">
            This meal has no foods configured yet.
          </div>
        ) : (
          <>
            {/* Step 1 — pick the food to swap */}
            {items.length > 1 && (
              <div>
                <p className="text-xs font-semibold text-foreground mb-2">Which food would you like to swap?</p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((it, idx) => {
                    const active = targetIndex === idx;
                    return (
                      <button
                        key={it.id || `${it.food_id}-${idx}`}
                        type="button"
                        onClick={() => handlePickTarget(idx)}
                        className={cn(
                          'text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors',
                          active
                            ? 'border-primary/55 bg-primary/[0.06] text-foreground'
                            : 'border-border/70 bg-secondary/30 text-muted-foreground hover:text-foreground hover:border-primary/30'
                        )}
                      >
                        {it.food_name || 'Food item'} · {fmtMacro(it.amount)} {it.unit || 'g'}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {targetItem && (
              <>
                {/* Step 2 — current item + candidates */}
                <div className="rounded-xl border border-white/[0.08] bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Current Item
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground mt-1.5 truncate">
                    {targetItem?.food_name || 'Food item'}
                  </h4>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                    <MacroChip label="Portion" value={`${fmtMacro(targetItem.amount)} ${targetItem.unit || 'g'}`} className="col-span-2 sm:col-span-1" />
                    <MacroChip label="Calories" value={`${Math.round(Number(targetItem.calories) || 0)}`} />
                    <MacroChip label="Protein" value={`${fmtMacro(targetItem.protein)}g`} />
                    <MacroChip label="Carbs" value={`${fmtMacro(targetItem.carbs)}g`} />
                    <MacroChip label="Fat" value={`${fmtMacro(targetItem.fat)}g`} />
                  </div>
                </div>

                {status === 'loading' && (
                  <p className="text-[12px] text-muted-foreground text-center py-6">
                    Finding the best macro-matched alternatives… (read-only)
                  </p>
                )}
                {status === 'invalid_target' && (
                  <p className="text-[12px] text-muted-foreground text-center py-6">
                    This item doesn't have valid calories or macros yet.
                  </p>
                )}
                {status === 'no_candidates' && (
                  <p className="text-[12px] text-muted-foreground text-center py-6">
                    {response?.reason || 'No foods are available in your nutrition context.'}
                  </p>
                )}
                {status === 'error' && (
                  <p className="text-[12px] text-red-400 text-center py-6">
                    Couldn't load replacement options. Please try again.
                  </p>
                )}
                {status === 'no_match' && (response?.results?.length || 0) === 0 && (
                  <p className="text-[12px] text-muted-foreground text-center py-4">
                    {response?.reason || 'No compatible alternatives right now — pick Other and your coach will help.'}
                  </p>
                )}

                {(status === 'ok' || status === 'no_match') && (
                  <div className="space-y-2">
                    {results.length > 0 && (
                      <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground/80 font-semibold">
                        <span className="h-px flex-1 bg-white/[0.08]" />
                        <ArrowLeftRight className="w-3.5 h-3.5 text-primary" />
                        Suggested alternatives
                        <span className="h-px flex-1 bg-white/[0.08]" />
                      </div>
                    )}

                    <motion.div
                      variants={listVariants}
                      initial="initial"
                      animate="animate"
                      className="space-y-2 max-h-[32vh] overflow-y-auto -mr-1 pr-1"
                    >
                      {results.map((r) => {
                        const selected = selectedCandidateId === r.food_id && !choseOther;
                        return (
                          <motion.button
                            key={r.food_id}
                            type="button"
                            variants={cardItemVariants}
                            {...cardHover}
                            onClick={() => {
                              setSelectedCandidateId(r.food_id);
                              setChoseOther(false);
                            }}
                            aria-pressed={selected}
                            className={cn(
                              'w-full text-left rounded-xl border p-3.5 transition-colors duration-200',
                              selected
                                ? 'border-primary/55 bg-primary/[0.05]'
                                : 'bg-card border-white/[0.08] hover:border-primary/30 hover:bg-primary/[0.02]'
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[13px] font-semibold text-foreground truncate">{r.name}</span>
                                  {r.name_ar && (
                                    <span dir="rtl" className="text-[11px] text-muted-foreground">
                                      ({r.name_ar})
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                  {r.food_role && (
                                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                      {roleLabel(r.food_role)}
                                    </Badge>
                                  )}
                                  {r.substitution_group && (
                                    <Badge className="text-[10px] text-primary bg-primary/10 border-transparent">
                                      {humanize(r.substitution_group)}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <span
                                className={cn(
                                  'mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors',
                                  selected ? 'bg-primary border-primary' : 'border-white/20'
                                )}
                              >
                                {selected && <Check className="w-3 h-3 text-primary-foreground" />}
                              </span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                              <MacroChip
                                label="Portion"
                                value={`${fmtMacro(r.recommended_amount)} ${r.recommended_unit || 'g'}`}
                                className="col-span-2 sm:col-span-1"
                              />
                              <MacroChip label="Calories" value={String(Math.round(r.estimated_calories || 0))} />
                              <MacroChip label="Protein" value={`${fmtMacro(r.estimated_protein)}g`} />
                              <MacroChip label="Carbs" value={`${fmtMacro(r.estimated_carbs)}g`} />
                              <MacroChip label="Fat" value={`${fmtMacro(r.estimated_fat)}g`} />
                            </div>
                            {r.explanation && (
                              <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
                                <Info className="w-3.5 h-3.5 shrink-0 text-primary/70 mt-0.5" />
                                <span>{r.explanation}</span>
                              </p>
                            )}
                          </motion.button>
                        );
                      })}

                      {/* Other option */}
                      <motion.button
                        type="button"
                        variants={cardItemVariants}
                        {...cardHover}
                        onClick={() => {
                          setChoseOther(true);
                          setSelectedCandidateId(null);
                        }}
                        aria-pressed={choseOther}
                        className={cn(
                          'w-full text-left rounded-xl border p-3.5 transition-colors duration-200',
                          choseOther
                            ? 'border-primary/55 bg-primary/[0.05]'
                            : 'bg-card border-dashed border-white/[0.12] hover:border-primary/30 hover:bg-primary/[0.02]'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="text-[13px] font-semibold text-foreground">Other</span>
                            <p dir="rtl" className="text-[12px] text-muted-foreground mt-1 clear-both text-right">
                              {OTHER_HELPER_TEXT}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors',
                              choseOther ? 'bg-primary border-primary' : 'border-white/20'
                            )}
                          >
                            {choseOther && <Check className="w-3 h-3 text-primary-foreground" />}
                          </span>
                        </div>
                      </motion.button>
                    </motion.div>
                  </div>
                )}
              </>
            )}

            {/* Step 3 — reason */}
            {targetItem && status !== 'loading' && (
              <div>
                <label className="text-sm font-semibold text-foreground block mb-1.5">
                  Why would you like to replace this meal?
                </label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={submitting || submitted}
                  placeholder="Tell your coach what you'd prefer…"
                  className="w-full p-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/50 resize-none"
                />
              </div>
            )}

            {submitError && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            {submitted ? (
              <div className="flex items-start gap-2.5 p-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06]">
                <Check className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                <div className="text-[12px] text-muted-foreground leading-relaxed">
                  <p className="font-semibold text-foreground">Request submitted</p>
                  <p className="mt-0.5">
                    Status:{' '}
                    <Badge className="text-[10px] text-amber-400 bg-amber-500/10 border-amber-500/25">Pending</Badge>{' '}
                    — your coach will review it and either apply the swap or suggest alternatives in chat.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
                <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className={canSubmit ? '' : 'opacity-60'}
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? 'Submitting…' : 'Request Replacement'}
                </Button>
              </div>
            )}

            {!choseOther && status === 'no_match' && (results.length === 0) && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <SearchX className="w-3.5 h-3.5" /> You can still use <strong>Other</strong> above to ask for more
                options in chat.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}