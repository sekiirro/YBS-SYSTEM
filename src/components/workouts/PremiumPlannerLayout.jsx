import React from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '@/lib/utils';
import { GripVertical } from 'lucide-react';

/**
 * PremiumPlannerLayout — Resizable 3-column shell for the YBS workout planner.
 *
 * Column 1 — Program Sidebar (program list + utility sections). Fixed-ish width.
 * Column 2 — Program Overview + Day Master List. Always visible when program selected.
 * Column 3 — Day Exercise Editor. Slides in when a training day is selected.
 *
 * Desktop: 3 resizable panels separated by drag gutters.
 * Mobile: single active panel with back navigation via `step` prop.
 *
 * @param {object} props
 * @param {React.ReactNode} props.column1 - Program sidebar content
 * @param {React.ReactNode} props.column2 - Day list / program overview content
 * @param {React.ReactNode} props.column3 - Exercise editor content
 * @param {boolean} props.showColumn3 - True when a training day is selected
 * @param {number} props.step - Mobile nav: 1=sidebar, 2=day list, 3=exercise editor
 * @param {() => void} props.onBackToCol1 - Mobile: col2 → col1
 * @param {() => void} props.onBackToCol2 - Mobile: col3 → col2
 * @param {string} [props.className] - Extra class for outer wrapper
 */
export default function PremiumPlannerLayout({
  column1,
  column2,
  column3,
  showColumn3 = false,
  step = 1,
  onBackToCol1,
  onBackToCol2,
  className,
}) {
  return (
    <div className={cn('relative w-full h-full', className)}>
      {/* ─── Desktop: Resizable panels ─── */}
      <div className="hidden md:flex h-full">
        <PanelGroup
          direction="horizontal"
          autoSaveId="ybs-planner-col-sizes"
          className="h-full"
        >
          {/* Column 1 — Program Sidebar */}
          <Panel
            id="ybs-col1"
            order={1}
            defaultSize={22}
            minSize={15}
            maxSize={32}
            className="flex flex-col overflow-hidden border-r border-border/40"
          >
            <div className="flex-1 overflow-y-auto h-full">
              {column1}
            </div>
          </Panel>

          <PlannerResizeHandle id="gutter-1-2" />

          {/* Column 2 — Day Master List */}
          <Panel
            id="ybs-col2"
            order={2}
            defaultSize={showColumn3 ? 28 : 78}
            minSize={22}
            className="flex flex-col overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto h-full">
              {column2}
            </div>
          </Panel>

          {/* Column 3 — Exercise Editor (only when day is selected) */}
          {showColumn3 && (
            <>
              <PlannerResizeHandle id="gutter-2-3" />
              <Panel
                id="ybs-col3"
                order={3}
                defaultSize={50}
                minSize={28}
                className="flex flex-col overflow-hidden border-l border-border/40"
              >
                <div className="flex-1 overflow-y-auto h-full animate-in fade-in-50 duration-200 slide-in-from-right-1">
                  {column3}
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      {/* ─── Mobile: Progressive single-column navigation ─── */}
      <div className="md:hidden h-full overflow-y-auto">
        {step === 1 && (
          <div className="h-full">
            {column1}
          </div>
        )}

        {step === 2 && (
          <div className="h-full flex flex-col">
            <button
              type="button"
              onClick={onBackToCol1}
              className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors px-4 py-3 border-b border-border/40 shrink-0 text-left bg-card/40"
            >
              ← Programs
            </button>
            <div className="flex-1 overflow-y-auto">
              {column2}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="h-full flex flex-col">
            <button
              type="button"
              onClick={onBackToCol2}
              className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors px-4 py-3 border-b border-border/40 shrink-0 text-left bg-card/40"
            >
              ← Day List
            </button>
            <div className="flex-1 overflow-y-auto animate-in fade-in-50 duration-200">
              {column3}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Shared styled resize handle gutter with hover + active feedback and keyboard accessibility.
 */
export function PlannerResizeHandle({ id, className }) {
  return (
    <PanelResizeHandle
      id={id}
      className={cn(
        'group relative flex items-center justify-center shrink-0',
        'w-[6px] bg-transparent cursor-col-resize select-none',
        'hover:bg-primary/10 active:bg-primary/20',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-inset',
        className
      )}
      aria-label="Drag to resize panel"
    >
      {/* Static divider line */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-px w-px bg-border/40 group-hover:bg-primary/40 group-active:bg-primary/60 transition-colors duration-150" />

      {/* Grip icon — reveals on hover/active */}
      <div className={cn(
        'relative z-10 flex items-center justify-center w-3.5 h-6 rounded-sm',
        'opacity-0 group-hover:opacity-100 group-active:opacity-100',
        'bg-secondary/90 border border-border/40 shadow-xs',
        'transition-all duration-150'
      )}>
        <GripVertical className="w-2.5 h-2.5 text-muted-foreground group-hover:text-foreground" />
      </div>
    </PanelResizeHandle>
  );
}
