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
    <div className="relative w-full overflow-hidden">
      {/* ─── Desktop layout ─── */}
      <div className="hidden md:flex gap-0 transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]">
        {/* Column 1 — Plan List */}
        <div
          className={cn(
            'shrink-0 transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-y-auto',
            step === 1 && 'w-full',
            step === 2 && 'w-[320px] min-w-[280px] border-r border-border/60',
            step === 3 && 'w-[240px] min-w-[220px] border-r border-border/60',
          )}
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          {column1}
        </div>

        {/* Column 2 — Plan Detail */}
        <div
          className={cn(
            'shrink-0 transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-y-auto',
            step < 2 && 'w-0 opacity-0 overflow-hidden',
            step === 2 && 'flex-1 opacity-100',
            step === 3 && 'w-[340px] min-w-[300px] border-r border-border/60 opacity-100',
          )}
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          {step >= 2 && column2}
        </div>

        {/* Column 3 — Meal/Day Editor */}
        <div
          className={cn(
            'shrink-0 transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-y-auto',
            step < 3 && 'w-0 opacity-0 overflow-hidden',
            step === 3 && 'flex-1 opacity-100',
          )}
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          {step >= 3 && column3}
        </div>
      </div>

      {/* ─── Mobile layout — single panel ─── */}
      <div className="md:hidden">
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
