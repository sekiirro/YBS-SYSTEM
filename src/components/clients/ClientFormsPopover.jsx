import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDate } from '@/lib/ybs-utils';
import { FileText, CheckCircle2, Clock, CheckCheck, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ClientFormsPopover({
  open,
  onClose,
  forms = [],
  clientName,
  onSelectForm,
  triggerRef,
}) {
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        triggerRef?.current &&
        !triggerRef.current.contains(e.target)
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]">
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, scale: 0.95, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -5 }}
          transition={{ duration: 0.15 }}
          className="w-full max-w-sm bg-[#0d1322] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden z-20"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-b from-[#11192e] to-[#090d16] border-b border-primary/20 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-foreground">
                All Forms ({forms.length})
              </h4>
              <p className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                {clientName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              aria-label="Close popover"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* List of Forms */}
          <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.04] p-1.5 space-y-1">
            {forms.map((f) => {
              const isSubmitted = f.submission_status === 'submitted';
              const isReviewed = f.submission_status === 'reviewed' || !!f.reviewed_at;
              const hasSubmitted = isSubmitted || isReviewed;

              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectForm(f);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left group focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary/80 shrink-0" />
                      <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {f.name || 'Assessment Form'}
                      </p>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 pl-5">
                      {hasSubmitted
                        ? `Submitted ${formatDate(f.submitted_at)}`
                        : `Assigned ${formatDate(f.created_at)}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasSubmitted ? (
                      <div className="flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" /> Submitted
                        </span>
                        {isReviewed && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-500/15 text-slate-300 border border-slate-500/25"
                            title="Reviewed"
                          >
                            <CheckCheck className="w-2.5 h-2.5 text-sky-400" />
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
