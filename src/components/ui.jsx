import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { cardItemVariants, cardHover, buttonMotion } from '@/lib/motion';

export function PageHeader({ title, description, actions, icon: Icon }) {
  return (
    <motion.div
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"
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
          <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {description && <p className="text-[13px] text-muted-foreground mt-1">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </motion.div>
  );
}

export function StatCard({ label, value, sublabel, icon: Icon, trend, accent }) {
  return (
    <motion.div
      variants={cardItemVariants}
      {...cardHover}
      className={cn(
        'rounded-xl border border-white/[0.08] bg-card p-5 transition-colors duration-200 cursor-default',
        accent ? 'shadow-[0_0_40px_-12px_hsl(var(--primary)/0.4)]' : 'hover:border-white/[0.14]'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground tabular-nums">{value}</span>
        {trend && (
          <span className={cn('text-xs font-semibold', trend > 0 ? 'text-green-400' : 'text-red-400')}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      {sublabel && <p className="text-[11px] text-muted-foreground mt-1.5">{sublabel}</p>}
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
      'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-colors duration-150',
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
      className="flex flex-col items-center justify-center py-16 text-center"
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
      {description && <p className="text-[13px] text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
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

export function Input({ label = '', error = '', hint = '', className = '', ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="text-[12px] font-medium text-muted-foreground">{label}</label>}
      <input
        className={cn(
          'w-full h-10 px-3 rounded-lg bg-secondary/40 border border-input text-[13px] text-foreground placeholder:text-muted-foreground/50',
          'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200',
          error && 'border-red-500/40',
          className
        )}
        {...props}
      />
      {error && (
        <motion.p
          className="text-[11px] text-red-400"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {error}
        </motion.p>
      )}
      {!error && hint && <p className="text-[11px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function Select({ label = '', error = '', className = '', children = null, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="text-[12px] font-medium text-muted-foreground">{label}</label>}
      <select
        className={cn(
          'w-full h-10 px-3 rounded-lg bg-secondary/40 border border-input text-[13px] text-foreground',
          'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200',
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

export function TextArea({ label = '', error = '', className = '', ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="text-[12px] font-medium text-muted-foreground">{label}</label>}
      <textarea
        className={cn(
          'w-full px-3 py-2.5 rounded-lg bg-secondary/40 border border-input text-[13px] text-foreground placeholder:text-muted-foreground/50',
          'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200 resize-none',
          error && 'border-red-500/40',
          className
        )}
        {...props}
      />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, size = 'md' }) {
  return (
    <AnimatePresenceWrapper>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className={cn(
              'relative w-full bg-card border border-white/10 rounded-2xl shadow-2xl shadow-black/50 max-h-[90vh] overflow-hidden flex flex-col',
              size === 'lg' ? 'max-w-2xl' : 'max-w-md'
            )}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] shrink-0">
              <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/5 text-xl leading-none"
              >×</button>
            </div>
            <div className="overflow-y-auto p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresenceWrapper>
  );
}

// Internal helper — AnimatePresence wrapper so Modal can use exit animations
export function AnimatePresenceWrapper({ children }) {
  return <AnimatePresence>{children}</AnimatePresence>;
}

export function Button({ children = null, variant = 'default', size = 'default', className = '', ...props }) {
  const variants = {
    default: 'bg-primary text-primary-foreground shadow-[0_0_40px_-10px_hsl(var(--primary)/0.6)] hover:bg-primary/90 hover:shadow-[0_0_50px_-8px_hsl(var(--primary)/0.8)]',
    primary: 'bg-primary text-primary-foreground shadow-[0_0_40px_-10px_hsl(var(--primary)/0.6)] hover:bg-primary/90 hover:shadow-[0_0_50px_-8px_hsl(var(--primary)/0.8)]',
    secondary: 'bg-white/5 text-foreground border border-white/10 hover:bg-white/[0.08]',
    outline: 'border border-white/15 text-foreground hover:border-primary/50 hover:bg-primary/5',
    ghost: 'text-muted-foreground hover:text-foreground hover:bg-white/5',
    destructive: 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20',
  };
  const sizes = {
    default: 'h-10 px-5 text-[13px]',
    sm: 'h-9 px-4 text-[12px]',
    lg: 'h-11 px-7 text-[14px]',
    icon: 'h-9 w-9',
  };
  return (
    <motion.button
      {...buttonMotion}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-tight transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none cursor-pointer whitespace-nowrap',
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