// Shared utility helpers for YBS
import { format, formatDistanceToNow, differenceInDays, differenceInCalendarDays, parseISO, isValid } from 'date-fns';

// SLA window: plans must be delivered within 3–7 calendar days after the
// client submits their intake form. The countdown is always derived from
// the form's submitted_at and never stored.
export const PLAN_DELIVERY_SLA_DAYS = 7;

export function formatDate(dateStr, fmt = 'MMM d, yyyy') {
  if (!dateStr) return '—';
  try {
    return format(parseISO(dateStr), fmt);
  } catch {
    return '—';
  }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy · h:mm a');
  } catch {
    return '—';
  }
}

export function timeAgo(dateStr) {
  if (!dateStr) return '—';
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function getLocalDateKey(dateVal = new Date()) {
  if (!dateVal) return null;
  try {
    return format(new Date(dateVal), 'yyyy-MM-dd');
  } catch {
    return null;
  }
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  try {
    return differenceInDays(parseISO(dateStr), new Date());
  } catch {
    return null;
  }
}

/**
 * Plan Delivery SLA countdown for a submitted form.
 * Days remaining are computed as calendar days between the submission day
 * and today in the viewer's local timezone (the user's perception of "days"),
 * so every browser renders the same number for the same submission day.
 *
 * Returns null when the form has no submission timestamp (SLA has not
 * started), otherwise:
 *   { kind: 'countdown', daysLeft }  — daysLeft 7..0
 *   { kind: 'overdue',   days }      — the form age beyond the SLA window
 */
export function planDeliveryState(submittedAt) {
  if (!submittedAt) return null;
  const submitted = parseISO(submittedAt);
  if (!isValid(submitted)) return null;
  let elapsed = differenceInCalendarDays(new Date(), submitted);
  // Guard against clock skew / future timestamps.
  if (elapsed < 0) elapsed = 0;
  const daysLeft = PLAN_DELIVERY_SLA_DAYS - elapsed;
  if (daysLeft < 0) {
    return { kind: 'overdue', days: Math.abs(daysLeft) };
  }
  return { kind: 'countdown', daysLeft };
}

/**
 * Urgency palette for the Plan Delivery countdown (spec-mandated mapping):
 *   0–2 days left -> success/green     3–4 -> blue/info
 *   5–6 -> yellow/warning              7+  -> red/critical
 *   overdue -> red/critical
 * Text is always shown too, so meaning is not color-only.
 */
export function getPlanDeliveryColor(state) {
  if (!state) return null;
  if (state.kind === 'overdue') return 'text-red-400 bg-red-500/10 border-red-500/20';
  if (state.daysLeft <= 2) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (state.daysLeft <= 4) return 'text-sky-400 bg-sky-500/10 border-sky-500/20';
  if (state.daysLeft <= 6) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

export function getPlanDeliveryLabel(state) {
  if (!state) return '—';
  if (state.kind === 'overdue') return `Overdue by ${state.days} day${state.days === 1 ? '' : 's'}`;
  if (state.daysLeft === 0) return 'Due today';
  return `${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left`;
}

export function getSubscriptionStatusColor(status) {
  const map = {
    active: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    pending: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    paid: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    expiring_soon: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    expired: 'text-red-400 bg-red-500/10 border-red-500/20',
    frozen: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    cancelled: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
    no_subscription: 'text-zinc-500 bg-zinc-500/5 border-zinc-500/15',
  };
  return map[status] || map.no_subscription;
}

export function getFormStatusColor(status) {
  const map = {
    pending: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    submitted: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    reviewed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    overdue: 'text-red-400 bg-red-500/10 border-red-500/20',
  };
  return map[status] || map.pending;
}

export function formatCurrency(amount, currency = 'EGP') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
  }).format(amount);
}

export function generateClientCode(existingCodes) {
  let max = 0;
  existingCodes.forEach((code) => {
    const num = parseInt(code?.replace('YBS-', ''), 10);
    if (!isNaN(num) && num > max) max = num;
  });
  return `YBS-${String(max + 1).padStart(4, '0')}`;
}

export function calculateSubscriptionEnd(startDate, duration, unit) {
  const start = new Date(startDate);
  const end = new Date(start);
  if (unit === 'days') end.setDate(end.getDate() + duration);
  else if (unit === 'weeks') end.setDate(end.getDate() + duration * 7);
  else if (unit === 'months') end.setMonth(end.getMonth() + duration);
  return end.toISOString().split('T')[0];
}

export function computeSubscriptionStatus(endDate) {
  if (!endDate) return 'no_subscription';
  const days = daysUntil(endDate);
  if (days < 0) return 'expired';
  if (days <= 7) return 'expiring_soon';
  return 'active';
}

export function getInitials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}