import React from 'react';
import { cn } from '@/lib/utils';

export default function ClientEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}) {
  return (
    <div className={cn('surface-card p-8 flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border/80', className)}>
      {Icon && (
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3.5 text-primary">
          <Icon className="w-6 h-6" />
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-foreground mb-1 font-display">{title}</h3>
      {description && (
        <p className="text-[13px] text-muted-foreground max-w-sm leading-relaxed mb-4">
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
