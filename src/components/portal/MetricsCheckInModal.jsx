import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Send } from 'lucide-react';
import { MetricsService } from '@/services/metrics';
import { Modal, Button, Input, Select, TextArea } from '@/components/ui';
import { CIRCUMFERENCE_FIELDS, VALIDATION_RANGES, toNumber, cmLabel, weightLabel, bodyFatLabel } from '@/lib/body-progress';

const LABELS = {
  neck: 'Neck',
  chest: 'Chest',
  waist: 'Waist',
  hip: 'Hip',
  right_arm: 'Arm (R)',
  left_arm: 'Arm (L)',
  right_thigh: 'Thigh (R)',
  left_thigh: 'Thigh (L)',
  right_calf: 'Calf (R)',
  left_calf: 'Calf (L)',
};

function lastValue(latest, field) {
  if (!latest) return null;
  const v = latest[field];
  if (v == null || v === '') return null;
  if (field === 'weight') return `last ${weightLabel(v)}`;
  if (field === 'body_fat') return `last ${bodyFatLabel(v)}`;
  return `last ${cmLabel(v)}`;
}

export default function MetricsCheckInModal({ open, onClose, clientId, workspaceId, latest, onSaved }) {
  const today = new Date().toISOString().split('T')[0];

  /** @returns {{ entry_date: string; weight: string; body_fat: string; body_fat_method: string; notes: string; measurements: Record<string, string> }} */
  const buildBlank = () => ({
    entry_date: today,
    weight: '',
    body_fat: '',
    body_fat_method: 'visual_estimate',
    notes: '',
    measurements: Object.fromEntries(CIRCUMFERENCE_FIELDS.map((f) => [f, ''])),
  });
  const blank = buildBlank();

  const [form, setForm] = useState(() => buildBlank());
  const [errors, setErrors] = useState(/** @type {Record<string, string | null>} */ ({}));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(buildBlank());
      setErrors({});
    }
  }, [open]);

  const setMeasurement = (key, value) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [key]: value } }));

  const handleSave = async () => {
    const errs = /** @type {Record<string, string | null>} */ ({});
    if (!form.entry_date) errs.entry_date = 'Date is required.';
    if (form.weight !== '') {
      const n = toNumber(form.weight);
      const r = VALIDATION_RANGES.weight;
      if (n == null || n < r.min || n > r.max) errs.weight = `Weight should be between ${r.min} and ${r.max} kg.`;
    }
    if (form.body_fat !== '') {
      const n = toNumber(form.body_fat);
      const r = VALIDATION_RANGES.body_fat;
      if (n == null || n < r.min || n > r.max) errs.body_fat = `Body fat should be between ${r.min} and ${r.max}%.`;
    }
    Object.keys(errs).length && setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const payload = { entry_date: form.entry_date };
      if (form.weight !== '') payload.weight = toNumber(form.weight);
      if (form.body_fat !== '') {
        payload.body_fat = toNumber(form.body_fat);
        payload.body_fat_method = form.body_fat_method || 'visual_estimate';
      }
      if (form.notes) payload.notes = form.notes;
      CIRCUMFERENCE_FIELDS.forEach((f) => {
        if (form.measurements[f] !== '') payload[f] = toNumber(form.measurements[f]);
      });
      await MetricsService.createCheckIn(clientId, workspaceId, payload);
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to save check-in:', err);
      setErrors({ save: err?.message || 'Something went wrong saving your check-in.' });
    } finally {
      setSaving(false);
    }
  };

  const emptyCount =
    (form.weight !== '' ? 1 : 0) +
    (form.body_fat !== '' ? 1 : 0) +
    CIRCUMFERENCE_FIELDS.reduce((n, f) => n + (form.measurements[f] !== '' ? 1 : 0), 0);

  return (
    <Modal open={open} onClose={onClose} title="Quick Check-in" size="lg">
      <p className="text-[12px] text-muted-foreground mb-5 leading-relaxed">
        Log a new progress snapshot. Leave anything blank and it won't be changed or duplicated —
        you can always log the missing part at your next check-in.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <Input
          label="Date"
          type="date"
          max={today}
          value={form.entry_date}
          onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
          error={errors.entry_date}
        />
        <Input
          label="Weight (kg)"
          type="number"
          inputMode="decimal"
          placeholder="—"
          value={form.weight}
          hint={lastValue(latest, 'weight')}
          onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
          error={errors.weight}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <Input
          label="Body Fat (%)"
          type="number"
          inputMode="decimal"
          placeholder="—"
          value={form.body_fat}
          hint={lastValue(latest, 'body_fat')}
          onChange={(e) => setForm((f) => ({ ...f, body_fat: e.target.value }))}
          error={errors.body_fat}
        />
        {form.body_fat !== '' && (
          <Select
            label="Body fat method"
            value={form.body_fat_method}
            onChange={(e) => setForm((f) => ({ ...f, body_fat_method: e.target.value }))}
          >
            <option value="visual_estimate">Visual estimate (guide photos)</option>
            <option value="manual_entry">Manual entry</option>
            <option value="navy_estimate">U.S. Navy method</option>
            <option value="bia">BIA scale</option>
            <option value="skinfold">Skinfold calipers</option>
            <option value="dexa">DEXA scan</option>
            <option value="other">Other / clinical</option>
          </Select>
        )}
      </div>

      <p className="text-[12px] font-medium text-muted-foreground mb-2">Circumference measurements (cm)</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        {CIRCUMFERENCE_FIELDS.map((f) => (
          <Input
            key={f}
            label={LABELS[f]}
            type="number"
            inputMode="decimal"
            placeholder="—"
            value={form.measurements[f]}
            hint={lastValue(latest, f)}
            onChange={(e) => setMeasurement(f, e.target.value)}
          />
        ))}
      </div>

      <TextArea
        label="Notes (optional)"
        rows={2}
        placeholder="Anything to remember about this check-in…"
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
      />

      {errors.save && (
        <p className="mt-4 text-[12px] text-red-400 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          {errors.save}
        </p>
      )}

      <div className="flex items-center justify-between pt-5 mt-5 border-t border-white/[0.08]">
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Plus className="w-3 h-3" /> {emptyCount} measurement{emptyCount === 1 ? '' : 's'} ready
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save Check-in'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}