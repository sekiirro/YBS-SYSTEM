import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { NotificationsService } from '@/services/notifications';
import { formatDate, formatDateTime, getInitials } from '@/lib/ybs-utils';
import { Button } from '@/components/ui';
import { toast } from '@/components/ui/use-toast';
import {
  X, Clock, Bell, Copy, Check, AlertCircle,
  Building2, Calendar, FileText, Send, CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PendingFormDrawer({
  open,
  onClose,
  form,
  client,
  workspaceName,
  onReminderSent,
}) {
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [lastReminder, setLastReminder] = useState(form?.last_reminder_at || null);
  const [cooldown, setCooldown] = useState(0);
  const [copied, setCopied] = useState(false);

  // Sync initial last reminder
  useEffect(() => {
    if (form?.last_reminder_at) {
      setLastReminder(form.last_reminder_at);
    }
  }, [form]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  if (!open || !form) return null;

  // Calculate urgency
  const now = new Date();
  let urgencyText = null;
  let isOverdue = false;

  if (form.due_date) {
    const due = new Date(form.due_date);
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      urgencyText = `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} overdue`;
      isOverdue = true;
    } else if (diffDays === 0) {
      urgencyText = 'Due today';
      isOverdue = true;
    } else if (diffDays <= 3) {
      urgencyText = `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
    }
  }

  const handleSendReminder = async () => {
    if (sending || cooldown > 0) return;
    try {
      setSending(true);

      if (client?.user_id) {
        await NotificationsService.create({
          workspace_id: form.workspace_id || client.workspace_id,
          user_id: client.user_id,
          type: 'form_reminder',
          title: 'Form Reminder: Action Required',
          message: `Please complete your assigned form "${form.name || 'Assessment'}" so your coach can prepare your plan.`,
          related_entity_type: 'assessment',
          related_entity_id: form.id,
        }).catch((err) => console.warn('Could not post notification:', err));
      }

      const nowIso = new Date().toISOString();
      setLastReminder(nowIso);
      setSentSuccess(true);
      setCooldown(15); // 15-second cooldown against accidental duplicate spam

      if (onReminderSent) {
        onReminderSent(form.id, nowIso);
      }

      toast({
        title: 'Reminder Sent Successfully',
        description: `Notification dispatched to ${client?.full_name || 'the client'}.`,
      });

      setTimeout(() => setSentSuccess(false), 4000);
    } catch (err) {
      console.error('Failed to send reminder:', err);
      toast({
        title: 'Failed to Send Reminder',
        description: err.message || 'An error occurred while sending the reminder.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleCopyLink = () => {
    const formUrl = `${window.location.origin}/portal/forms/${form.id}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(formUrl);
      setCopied(true);
      toast({
        title: 'Form Link Copied',
        description: 'Direct link to client intake form copied to clipboard.',
      });
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        />

        {/* Compact Modal Dialog */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative w-full max-w-md bg-[#0b0f19] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden z-10"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-primary/20 bg-gradient-to-b from-[#11192e] to-[#0d1322] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.15)] flex items-center justify-center text-amber-400 font-bold text-xs shrink-0">
                {getInitials(client?.full_name)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground truncate">
                    {client?.full_name}
                  </h3>
                  <span className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-muted-foreground border border-white/[0.08]">
                    {client?.client_code}
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span className="text-amber-400 font-medium">Pending Submission</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form Meta Card */}
          <div className="p-5 space-y-4">
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-[14px] font-semibold text-foreground truncate">
                    {form.name || 'Assessment Form'}
                  </span>
                </div>
                {urgencyText && (
                  <span
                    className={cn(
                      'text-[12px] font-semibold px-2 py-0.5 rounded-full shrink-0 border',
                      isOverdue
                        ? 'bg-red-500/10 text-red-400 border-red-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    )}
                  >
                    {urgencyText}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[12px] pt-1 border-t border-white/[0.04]">
                <div>
                  <span className="text-muted-foreground block">Date Sent</span>
                  <span className="text-foreground font-medium">{formatDate(form.created_at)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Due Date</span>
                  <span className={cn('font-medium', isOverdue ? 'text-red-400' : 'text-foreground')}>
                    {form.due_date ? formatDate(form.due_date) : 'No deadline'}
                  </span>
                </div>
              </div>
            </div>

            {/* Reminder Status */}
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#0d1322] border border-white/[0.04] text-[12px]">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Bell className="w-3.5 h-3.5 text-primary/80" />
                <span>Last Reminder:</span>
              </div>
              <span className="font-medium text-foreground">
                {lastReminder ? formatDateTime(lastReminder) : 'No reminder sent yet'}
              </span>
            </div>

            {/* Success Message Banner */}
            {sentSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Reminder sent successfully to client!</span>
              </motion.div>
            )}

            {/* Action Buttons */}
            <div className="pt-2 space-y-2">
              <Button
                onClick={handleSendReminder}
                disabled={sending || cooldown > 0}
                className={cn(
                  'w-full gap-2 text-xs font-semibold h-10 transition-all',
                  cooldown > 0
                    ? 'bg-secondary text-muted-foreground cursor-not-allowed border border-white/[0.06]'
                    : 'bg-amber-500 hover:bg-amber-600 text-black shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                )}
                aria-label="Send reminder to client"
              >
                {cooldown > 0 ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Reminder Sent (Cooldown {cooldown}s)</span>
                  </>
                ) : sending ? (
                  <span>Sending Reminder…</span>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Reminder</span>
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleCopyLink}
                  className="flex-1 gap-1.5 text-xs h-9"
                  aria-label="Copy form link to clipboard"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Link Copied' : 'Copy Form Link'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={onClose}
                  className="px-4 text-xs h-9"
                  aria-label="Close modal"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
