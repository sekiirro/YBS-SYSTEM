// Shared utility helpers for YBS
import { format, formatDistanceToNow, differenceInDays, parseISO } from 'date-fns';

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

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  try {
    return differenceInDays(parseISO(dateStr), new Date());
  } catch {
    return null;
  }
}

export function getSubscriptionStatusColor(status) {
  const map = {
    active: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
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

export function formatCurrency(amount) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
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