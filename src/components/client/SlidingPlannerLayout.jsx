import React from 'react';
import { cn } from '@/lib/utils';

/**
 * SlidingPlannerLayout — Progressive-disclosure 3-column planner layout.
 *
 * States:
 *   step=1  → only Column 1 visible (plan list)
 *   step=2  → Column 1 + Column 2 (plan selected)
 *   step=3  → Column 1 + Column 2 + Column 3 (detail selected)
 *
 * Desktop: columns slide side-by-side.
 * Mobile: only the active column is shown full-width.
 */
export default function SlidingPlannerLayout({
  step = 1,
  column1,
  column2,
  column3,
  onBack,
}) {
  return (
    <div className="ybs-planner relative w-full overflow-hidden">
      {/* ─── Desktop layout ─── */}
      <div className="hidden xl:flex gap-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
        {/* Column 1 — Plan List */}
        <div
          className={cn(
            'shrink-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-y-auto border-r border-nutri-border-strong',
            step === 1 && 'w-full',
            step === 2 && 'w-[300px] min-w-[260px]',
            step === 3 && 'w-[232px] min-w-[208px]',
          )}
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          {column1}
        </div>

        {/* Column 2 — Plan Detail */}
        <div
          className={cn(
            'shrink-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-y-auto',
            step < 2 && 'w-0 opacity-0 overflow-hidden',
            step === 2 && 'flex-1 min-w-0 opacity-100',
            step === 3 && 'w-[332px] min-w-[296px] border-r border-nutri-border-strong opacity-100',
          )}
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          {step >= 2 && column2}
        </div>

        {/* Column 3 — Meal/Day Editor */}
        <div
          className={cn(
            'shrink-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-y-auto',
            step < 3 && 'w-0 opacity-0 overflow-hidden',
            step === 3 && 'flex-1 min-w-0 opacity-100',
          )}
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          {step >= 3 && column3}
        </div>
      </div>

      {/* ─── Mobile layout — single panel ─── */}
      <div className="xl:hidden">
        {step === 1 && column1}
        {step === 2 && (
          <div>
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              ← Plans
            </button>
            {column2}
          </div>
        )}
        {step === 3 && (
          <div>
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              ← Back
            </button>
            {column3}
          </div>
        )}
      </div>
    </div>
  );
}
