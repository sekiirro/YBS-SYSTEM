import React, { useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { cardItemVariants, buttonMotion } from '@/lib/motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const MotionLink = motion(Link);

export function PageHeader({ title, description, actions, icon: Icon }) {
  return (
    <motion.div
      className="ybs-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        )}
        <div>
          <h1 className="ybs-title">{title}</h1>
          {description && <p className="text-[14px] text-muted-foreground mt-1">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </motion.div>
  );
}

export function StatCard({ label, value, sublabel, icon: Icon, trend, accent, to, onClick, ariaLabel }) {
  const interactive = !!to || !!onClick;
  const accessibilityLabel = ariaLabel || `${label}: ${value}.`;
  const className = cn(
    'ybs-stat transition-colors duration-200 min-w-0',
    accent && 'ybs-stat-accent',
    interactive &&
      'cursor-pointer hover:bg-primary/5 hover:ring-1 hover:ring-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
  );

  const content = (
    <>
      <div className="flex items-start justify-between mb-3">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="ybs-stat-value tabular-nums">{value}</span>
        {trend && (
          <span className={cn('text-xs font-semibold', trend > 0 ? 'text-green-400' : 'text-red-400')}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      {sublabel && <p className="text-[12px] text-muted-foreground mt-1.5">{sublabel}</p>}
    </>
  );

  if (to) {
    return (
      <MotionLink
        to={to}
        variants={cardItemVariants}
        whileTap={{ scale: 0.985 }}
        className={className}
        aria-label={accessibilityLabel}
      >
        {content}
      </MotionLink>
    );
  }
  if (onClick) {
    return (
      <motion.button
        type="button"
        onClick={onClick}
        variants={cardItemVariants}
        whileTap={{ scale: 0.985 }}
        className={className}
        aria-label={accessibilityLabel}
      >
        {content}
      </motion.button>
    );
  }
  return (
    <motion.div variants={cardItemVariants} className={cn('ybs-stat transition-colors duration-200 cursor-default min-w-0', accent && 'ybs-stat-accent')}>
      {content}
    </motion.div>
  );
}

export function Badge({ children, variant = 'default', className = '' }) {
  const variants = {
    default: 'bg-primary/15 text-primary border-transparent',
    outline: 'border-white/15 text-foreground',
    success: 'bg-green-500/15 text-green-400 border-transparent',
    warning: 'bg-amber-500/15 text-amber-400 border-transparent',
    destructive: 'bg-red-500/15 text-red-400 border-transparent',
  };
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-semibold border transition-colors duration-150',
      variants[variant] || variants.default,
      className
    )}>
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <motion.div
      className="ybs-empty flex flex-col items-center justify-center text-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-muted-foreground" />
        </div>
      )}
      <h3 className="text-[15px] font-medium text-foreground mb-1">{title}</h3>
      {description && <p className="text-[14px] text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export function LoadingState({ label }) {
  return (
    <div className="ybs-loading" role="status" aria-live="polite" aria-busy="true">
      <p className="text-sm text-muted-foreground mb-6">{label || 'Loading your workspace…'}</p>
      <div aria-hidden="true" className="space-y-6">
        <div className="ybs-skeleton h-9 w-2/3 max-w-sm" />
        <div className="ybs-skeleton h-40 w-full" />
        <div className="grid grid-cols-2 gap-4"><div className="ybs-skeleton h-24" /><div className="ybs-skeleton h-24" /></div>
      </div>
    </div>
  );
}

export function ErrorState({ title = 'Something interrupted the connection', description = 'Your information could not be loaded. Please try again.', onRetry }) {
  return <div className="ybs-error" role="alert"><h2 className="ybs-section-title">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p>{onRetry && <Button variant="outline" className="mt-5" onClick={onRetry}>Try again</Button>}</div>;
}

export function Input({ label = '', error = '', hint = '', className = '', ...props }) {
  const generatedId = useId();
  const id = props.id || generatedId;
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>}
      <input
        className={cn(
          'ybs-field w-full px-3 border border-input text-foreground placeholder:text-muted-foreground',
          'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200',
          error && 'border-red-500/40',
          className
        )}
        {...props}
        id={id}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-help` : props['aria-describedby']}
      />
      {error && (
        <motion.p
          id={`${id}-help`}
          role="alert"
          className="text-[12px] text-red-400"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {error}
        </motion.p>
      )}
      {!error && hint && <p id={`${id}-help`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Select({ label = '', error = '', className = '', children = null, ...props }) {
  const generatedId = useId();
  const id = props.id || generatedId;
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>}
      <select
        className={cn(
          'ybs-field w-full px-3 border border-input text-foreground',
          'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200',
          error && 'border-red-500/40',
          className
        )}
        {...props}
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : props['aria-describedby']}
      >
        {children}
      </select>
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function TextArea({ label = '', error = '', className = '', ...props }) {
  const generatedId = useId();
  const id = props.id || generatedId;
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>}
      <textarea
        className={cn(
          'ybs-field w-full px-3 py-3 border border-input text-foreground placeholder:text-muted-foreground',
          'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200 resize-none',
          error && 'border-red-500/40',
          className
        )}
        {...props}
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : props['aria-describedby']}
      />
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, size = 'md' }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent aria-describedby={undefined} className={cn('ybs-dialog p-0 flex flex-col', size === 'lg' ? 'max-w-2xl' : 'max-w-md')}>
        <DialogHeader className="px-6 py-5 pr-16 border-b border-border shrink-0 text-left">
          <DialogTitle className="ybs-dialog-title">{title}</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto overscroll-contain p-6">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

// Internal helper — AnimatePresence wrapper so Modal can use exit animations
export function AnimatePresenceWrapper({ children }) {
  return <AnimatePresence>{children}</AnimatePresence>;
}

export function Button({ children = null, variant = 'default', size = 'default', className = '', ...props }) {
  const variants = {
    default: 'ybs-button-primary',
    primary: 'ybs-button-primary',
    secondary: 'bg-white/5 text-foreground border border-white/10 hover:bg-white/[0.08]',
    outline: 'border border-white/15 text-foreground hover:border-primary/50 hover:bg-primary/5',
    ghost: 'text-muted-foreground hover:text-foreground hover:bg-white/5',
    destructive: 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20',
  };
  const sizes = {
    default: 'h-10 px-5 text-[14px]',
    sm: 'h-10 px-4 text-sm',
    lg: 'h-11 px-7 text-[14px]',
    icon: 'h-11 w-11',
  };
  return (
    <motion.button
      {...buttonMotion}
      className={cn(
        'ybs-button inline-flex items-center justify-center gap-2 tracking-tight disabled:opacity-50 disabled:pointer-events-none cursor-pointer whitespace-nowrap',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
