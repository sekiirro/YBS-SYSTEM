import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Modal, Button, Badge, EmptyState, LoadingState } from '@/components/ui';
import { findFoodReplacements } from '@/services';
import { cardItemVariants, listVariants, cardHover } from '@/lib/motion';
import { ArrowLeftRight, AlertCircle, Check, Info, PackageSearch, SearchX, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

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

function MacroChip({ label, value, className }) {
  return (
    <div className={cn('rounded-lg bg-background/60 border border-white/[0.06] px-2 py-1.5 text-center', className)}>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground/80 font-medium leading-tight">{label}</p>
      <p className="text-[12px] font-semibold text-foreground font-mono mt-0.5">{value}</p>
    </div>
  );
}

export default function ReplaceFoodModal({ open, onClose, item, workspaceId, onApply }) {
  const [status, setStatus] = useState('idle');
  const [response, setResponse] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    setStatus('loading');
    setResponse(null);
    setSelectedId(null);
    setApplyError('');

    (async () => {
      try {
        const target = {
          calories: Number(item.calories) || 0,
          protein: Number(item.protein) || 0,
          carbs: Number(item.carbs) || 0,
          fat: Number(item.fat) || 0,
          amount: Number(item.amount) > 0 ? Number(item.amount) : null,
          unit: item.unit || 'g',
          food_id: item.food_id || null,
        };
        const res = await findFoodReplacements({
          target,
          food: item.base_food || null,
          workspaceId,
          excludedFoodIds: item.food_id ? [item.food_id] : [],
        });
        if (!cancelled) {
          setResponse(res);
          setStatus(res.status);
        }
      } catch (err) {
        console.error('Failed to compute food replacements:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, item, workspaceId, retryKey]);

  const results = response?.results || [];

  const handleApply = async () => {
    const candidate = results.find((r) => r.food_id === selectedId);
    if (!candidate || applying) return;
    setApplying(true);
    setApplyError('');
    try {
      await onApply(candidate);
      setApplying(false);
    } catch (err) {
      console.error('Apply replacement failed:', err);
      setApplyError(err?.message || 'Failed to apply the replacement. Your item was not changed. Please try again.');
      setApplying(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Find Food Replacement" size="lg">
      <div className="space-y-4">
        {/* Current item summary */}
        <div className="rounded-xl border border-white/[0.08] bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Current Item</span>
            {item?.brand && (
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                {item.brand}
              </Badge>
            )}
          </div>
          <h4 className="text-sm font-semibold text-foreground mt-1.5 truncate">{item?.food_name || 'Food item'}</h4>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
            <MacroChip
              label="Portion"
              value={item ? `${fmtMacro(item.amount)} ${item.unit || 'g'}` : '—'}
              className="col-span-2 sm:col-span-1"
            />
            <MacroChip label="Calories" value={item ? `${Math.round(Number(item.calories) || 0)}` : '—'} />
            <MacroChip label="Protein" value={item ? `${fmtMacro(item.protein)}g` : '—'} />
            <MacroChip label="Carbs" value={item ? `${fmtMacro(item.carbs)}g` : '—'} />
            <MacroChip label="Fat" value={item ? `${fmtMacro(item.fat)}g` : '—'} />
          </div>
        </div>

        {status === 'ok' && results.length > 0 && (
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground/80 font-semibold">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <ArrowLeftRight className="w-3.5 h-3.5 text-primary" />
            Replace with
            <span className="h-px flex-1 bg-white/[0.08]" />
          </div>
        )}

        <motion.div
          key={status}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {status === 'loading' && (
            <LoadingState label="Finding the best macro-matched alternatives…" />
          )}

          {status === 'invalid_target' && (
            <EmptyState
              icon={XCircle}
              title="No usable nutrition target"
              description="This item doesn't have valid calories or macros yet. Set its amount first, then try Replace again."
            />
          )}

          {status === 'no_candidates' && (
            <EmptyState
              icon={SearchX}
              title="No foods available"
              description={response?.reason || 'The food database returned no accessible foods for your workspace.'}
            />
          )}

          {status === 'no_match' && (
            <EmptyState
              icon={PackageSearch}
              title="No compatible replacements"
              description={response?.reason || 'No candidates matched the current constraints. Try again with a different item.'}
            />
          )}

          {status === 'error' && (
            <EmptyState
              icon={AlertCircle}
              title="Couldn't generate replacements"
              description="Something went wrong while finding alternatives. Please try again."
              action={
                <Button variant="secondary" size="sm" onClick={() => setRetryKey((k) => k + 1)}>
                  Try Again
                </Button>
              }
            />
          )}

          {status === 'ok' && results.length === 0 && (
            <EmptyState
              icon={SearchX}
              title="No replacements found"
              description="The engine returned no candidate foods for this item."
            />
          )}

          {status === 'ok' && results.length > 0 && (
            <>
              <motion.div
                variants={listVariants}
                initial="initial"
                animate="animate"
                className="space-y-2 max-h-[40vh] overflow-y-auto -mr-1 pr-1"
              >
                {results.map((r) => {
                  const selected = selectedId === r.food_id;
                  return (
                    <motion.button
                      key={r.food_id}
                      type="button"
                      variants={cardItemVariants}
                      {...cardHover}
                      onClick={() => setSelectedId(selected ? null : r.food_id)}
                      disabled={applying}
                      aria-pressed={selected}
                      className={cn(
                        'w-full text-left rounded-xl border p-3.5 transition-colors duration-200 disabled:opacity-60 disabled:pointer-events-none',
                        selected
                          ? 'border-primary/55 bg-primary/[0.05]'
                          : 'bg-card border-white/[0.08] hover:border-primary/30 hover:bg-primary/[0.02]',
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
                            selected ? 'bg-primary border-primary' : 'border-white/20',
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
              </motion.div>

              <div className="pt-1">
                {applyError && (
                  <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center gap-2.5 text-red-400 text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{applyError}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
                  <Button variant="secondary" size="sm" onClick={onClose} disabled={applying}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleApply} disabled={!selectedId || applying}>
                    {applying ? 'Applying…' : 'Apply Replacement'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </Modal>
  );
}