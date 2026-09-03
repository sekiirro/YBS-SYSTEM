import React from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions, icon: Icon }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        )}
        <div>
          <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="text-[13px] text-muted-foreground mt-1">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, sublabel, icon: Icon, trend, accent }) {
  return (
    <div className={cn('surface-card p-5 transition-all hover:glow-subtle', accent && 'glow-primary')}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-secondary/60 flex items-center justify-center">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl lg:text-3xl font-display font-semibold tracking-tight text-foreground tabular-nums">{value}</span>
        {trend && (
          <span className={cn('text-xs font-medium', trend > 0 ? 'text-emerald-400' : 'text-red-400')}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      {sublabel && <p className="text-[11px] text-muted-foreground mt-1.5">{sublabel}</p>}
    </div>
  );
}

export function Badge({ children, className }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border', className)}>
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-secondary/50 border border-border flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-muted-foreground" />
        </div>
      )}
      <h3 className="text-[15px] font-medium text-foreground mb-1">{title}</h3>
      {description && <p className="text-[13px] text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label }) {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex flex-col items-center gap-3">
        <div className="w-7 h-7 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        {label && <p className="text-[13px] text-muted-foreground">{label}</p>}
      </div>
    </div>
  );
}

export function Input({ label, error, className, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="text-[12px] font-medium text-muted-foreground">{label}</label>}
      <input
        className={cn(
          'w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] text-foreground placeholder:text-muted-foreground/50',
          'focus:outline-none focus:border-primary/40 focus:bg-secondary transition-colors',
          error && 'border-red-500/40',
          className
        )}
        {...props}
      />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

export function Select({ label, error, className, children, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="text-[12px] font-medium text-muted-foreground">{label}</label>}
      <select
        className={cn(
          'w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] text-foreground',
          'focus:outline-none focus:border-primary/40 focus:bg-secondary transition-colors',
          error && 'border-red-500/40',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

export function TextArea({ label, error, className, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="text-[12px] font-medium text-muted-foreground">{label}</label>}
      <textarea
        className={cn(
          'w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-[13px] text-foreground placeholder:text-muted-foreground/50',
          'focus:outline-none focus:border-primary/40 focus:bg-secondary transition-colors resize-none',
          error && 'border-red-500/40',
          className
        )}
        {...props}
      />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, size }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative w-full bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col', size === 'lg' ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-[15px] font-display font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Button({ children, variant = 'default', size = 'default', className, ...props }) {
  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-foreground hover:bg-secondary/80 border border-border',
    outline: 'border border-border text-foreground hover:bg-secondary/50',
    ghost: 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
    destructive: 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20',
  };
  const sizes = {
    default: 'h-9 px-4 text-[13px]',
    sm: 'h-8 px-3 text-[12px]',
    lg: 'h-10 px-5 text-[14px]',
    icon: 'h-9 w-9',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}