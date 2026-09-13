import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Camera, Check, Loader2, Users, Ruler } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricsService } from '@/services/metrics';
import { Modal, Button, Input, Select, TextArea } from '@/components/ui';
import BodyFatVisualSelector from './BodyFatVisualSelector';
import {
  CIRCUMFERENCE_FIELDS,
  VALIDATION_RANGES,
  MEASURING_GUIDE_URL,
  getBaselineState,
  toNumber,
} from '@/lib/body-progress';

const STEPS = [
  { id: 'info', label: 'Body Info' },
  { id: 'fat', label: 'Body Fat' },
  { id: 'measurements', label: 'Measurements' },
];

function draftKey(clientId) {
  return `ybs-baseline-draft-${clientId || 'anon'}`;
}

export default function MetricsBaselineWizard({ open, onClose, clientId, state, onSaved }) {
  const baseline = useMemo(() => getBaselineState(state), [state]);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [fatMode, setFatMode] = useState('visual');

  const buildBlank = (bs) => ({
    sex: bs.sex || '',
    date_of_birth: bs.date_of_birth || '',
    height: bs.height != null ? String(bs.height) : '',
    weight: bs.weight != null ? String(bs.weight) : '',
    body_fat: bs.body_fat != null ? String(bs.body_fat) : '',
    body_fat_method: bs.body_fat_method || 'visual_estimate',
    notes: '',
    measurements: Object.fromEntries(
      CIRCUMFERENCE_FIELDS.map((f) => [f, bs.baselineRow?.[f] != null ? String(bs.baselineRow[f]) : ''])
    ),
  });
  const blank = buildBlank(baseline);

  const [form, setForm] = useState(() => buildBlank(baseline));
  const [errors, setErrors] = useState(/** @type {Record<string, string | null>} */ ({}));

  useEffect(() => {
    if (open) {
      setStep(0);
      setErrors({});
      try {
        const raw = sessionStorage.getItem(draftKey(clientId));
        setForm(raw ? { ...blank, ...JSON.parse(raw) } : blank);
      } catch {
        setForm(blank);
      }
    }
  }, [open, clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    try {
      sessionStorage.setItem(draftKey(clientId), JSON.stringify(form));
    } catch {
      // best-effort draft persistence
    }
  }, [form, open, clientId]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setMeasurement = (key, value) =>
    setForm((f) => ({ ...f, measurements: { ...f.measurements, [key]: value } }));

  const validateField = (key, value, skipEmpty = true) => {
    if (value === '' || value == null) {
      if (skipEmpty) return null;
      return `${VALIDATION_RANGES[key].label} is required.`;
    }
    const n = toNumber(value);
    const range = VALIDATION_RANGES[key];
    if (n == null) return `Enter a valid number for ${range.label}.`;
    if (n < range.min || n > range.max)
      return `${range.label} should be between ${range.min} and ${range.max}.`;
    return null;
  };

  const validateDateOfBirth = () => {
    if (!form.date_of_birth) return 'Date of birth is required.';
    const dob = new Date(`${form.date_of_birth}T00:00:00`);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) return 'Please enter a valid date of birth.';
    return null;
  };

  const stepError = (idx) => {
    if (idx === 0) {
      const errs = {
        sex: form.sex ? null : 'Please choose Male or Female.',
        date_of_birth: validateDateOfBirth(),
        height: validateField('height', form.height, false),
        weight: validateField('weight', form.weight, false),
      };
      return Object.values(errs).find(Boolean) || null;
    }
    if (idx === 1) {
      if (!form.body_fat) return null; // skipped is valid
      return validateField('body_fat', form.body_fat, false);
    }
    return null;
  };

  const goNext = () => {
    const err = stepError(step);
    if (err) {
      const base = { ...errors };
      if (step === 0) {
        if (!form.sex) base.sex = 'Please choose Male or Female.';
        base.date_of_birth = validateDateOfBirth();
        base.height = validateField('height', form.height, false);
        base.weight = validateField('weight', form.weight, false);
      }
      setErrors(base);
      return;
    }
    const cleared = { ...errors };
    delete cleared.sex;
    delete cleared.date_of_birth;
    delete cleared.height;
    delete cleared.weight;
    setErrors(cleared);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {};
      if (form.sex) payload.sex = form.sex;
      if (form.date_of_birth) payload.date_of_birth = form.date_of_birth;
      if (form.height !== '') payload.height = toNumber(form.height);
      if (form.weight !== '') payload.weight = toNumber(form.weight);
      if (form.body_fat !== '') {
        payload.body_fat = toNumber(form.body_fat);
        payload.body_fat_method = form.body_fat_method;
      }
      if (form.notes) payload.notes = form.notes;
      CIRCUMFERENCE_FIELDS.forEach((f) => {
        if (form.measurements[f] !== '') payload[f] = toNumber(form.measurements[f]);
      });
      await MetricsService.saveBaseline(clientId, payload);
      try {
        sessionStorage.removeItem(draftKey(clientId));
      } catch {
        // ignore
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to save baseline:', err);
      setErrors({ save: err?.message || 'Something went wrong saving your baseline.' });
    } finally {
      setSaving(false);
    }
  };

  const circumferenceLabels = {
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

  return (
    <Modal open={open} onClose={onClose} title="Set Up Your Body Progress Baseline" size="lg">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors',
                i === step
                  ? 'bg-primary/15 text-primary border-primary/25'
                  : i < step
                    ? 'text-green-400 bg-green-500/10 border-green-500/20'
                    : 'text-muted-foreground bg-white/[0.03] border-white/10'
              )}
            >
              {i < step ? <Check className="w-3 h-3" /> : <span className="w-4 h-4 flex items-center justify-center">{i + 1}</span>}
              {s.label}
            </div>
            {i < STEPS.length - 1 && <div className="w-6 h-px bg-border/70" />}
          </div>
        ))}
      </div>

      {/* STEP 0 — Body Info */}
      {step === 0 && (
        <div className="space-y-5">
          <div>
            <label className="text-[12px] font-medium text-muted-foreground block mb-2">Sex</label>
            <div className="grid grid-cols-2 gap-3">
              {['male', 'female'].map((sx) => (
                <button
                  key={sx}
                  type="button"
                  onClick={() => setField('sex', sx)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-all',
                    form.sex === sx
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                  )}
                >
                  <Users className={cn('w-4 h-4', form.sex === sx ? 'text-primary' : 'text-muted-foreground')} />
                  <p className="mt-2 text-[13px] font-medium capitalize text-foreground">{sx}</p>
                  <p className="text-[11px] text-muted-foreground">Used for body-fat reference photos</p>
                </button>
              ))}
            </div>
            {errors.sex && <p className="text-[11px] text-red-400 mt-1.5">{errors.sex}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Date of Birth"
              type="date"
              max={new Date().toISOString().split('T')[0]}
              value={form.date_of_birth}
              onChange={(e) => setField('date_of_birth', e.target.value)}
              error={errors.date_of_birth}
            />
            <Input
              label="Height (cm)"
              type="number"
              inputMode="decimal"
              min={VALIDATION_RANGES.height.min}
              max={VALIDATION_RANGES.height.max}
              placeholder="e.g. 175"
              value={form.height}
              onChange={(e) => setField('height', e.target.value)}
              error={errors.height}
            />
            <Input
              label="Current Weight (kg)"
              type="number"
              inputMode="decimal"
              min={VALIDATION_RANGES.weight.min}
              max={VALIDATION_RANGES.weight.max}
              placeholder="e.g. 82.5"
              value={form.weight}
              onChange={(e) => setField('weight', e.target.value)}
              error={errors.weight}
            />
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <Ruler className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              This starting point powers your BMI, lean mass, FFMI and Waist-to-Height calculations
              — you can update it any time.
            </p>
          </div>
        </div>
      )}

      {/* STEP 1 — Body Fat */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'visual', label: 'Reference guide photos', desc: 'Estimate visually' },
              { id: 'manual', label: 'Enter my own value', desc: 'I know my number' },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setFatMode(mode.id)}
                className={cn(
                  'rounded-xl border p-4 text-left transition-all',
                  fatMode === mode.id
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                )}
              >
                <Camera className={cn('w-4 h-4', fatMode === mode.id ? 'text-primary' : 'text-muted-foreground')} />
                <p className="mt-2 text-[13px] font-medium text-foreground">{mode.label}</p>
                <p className="text-[11px] text-muted-foreground">{mode.desc}</p>
              </button>
            ))}
          </div>

          {fatMode === 'visual' ? (
            <div className="flex flex-col items-center">
              {form.sex ? (
                <BodyFatVisualSelector
                  sex={form.sex}
                  value={form.body_fat !== '' ? toNumber(form.body_fat) : null}
                  onChange={(v) => setForm((f) => ({ ...f, body_fat: String(v), body_fat_method: 'visual_estimate' }))}
                />
              ) : (
                <p className="text-[12px] text-muted-foreground text-center py-8">
                  Choose Male or Female in the previous step to see the correct reference photos.
                </p>
              )}
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, body_fat: '', body_fat_method: 'visual_estimate' }))}
                className="mt-3 text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                I'd rather add this later — skip for now
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-w-sm">
              <Input
                label="Body fat (%)"
                type="number"
                inputMode="decimal"
                min={VALIDATION_RANGES.body_fat.min}
                max={VALIDATION_RANGES.body_fat.max}
                placeholder="e.g. 18.5"
                value={form.body_fat}
                onChange={(e) => setForm((f) => ({ ...f, body_fat: e.target.value }))}
                error={errors.body_fat}
              />
              <Select
                label="How was this measured?"
                value={form.body_fat_method || 'manual_entry'}
                onChange={(e) => setField('body_fat_method', e.target.value)}
              >
                <option value="manual_entry">Manual entry</option>
                <option value="navy_estimate">U.S. Navy method</option>
                <option value="bia">BIA scale</option>
                <option value="skinfold">Skinfold calipers</option>
                <option value="dexa">DEXA scan</option>
                <option value="other">Other / clinical</option>
              </Select>
              {errors.body_fat && <p className="text-[11px] text-red-400">{errors.body_fat}</p>}
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, body_fat: '', body_fat_method: 'manual_entry' }))}
                className="text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Skip for now
              </button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Visual estimates are stored separately from measured values — they're always shown as
            &quot;visual estimate&quot; and never presented as a scan or caliper reading.
          </p>
        </div>
      )}

      {/* STEP 2 — Measurements */}
      {step === 2 && (
        <div className="space-y-5">
          <a
            href={MEASURING_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-[12px] text-primary hover:underline"
          >
            <BookOpen className="w-4 h-4" /> How to measure correctly (video guide)
          </a>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CIRCUMFERENCE_FIELDS.map((f) => (
              <Input
                key={f}
                label={`${circumferenceLabels[f]} (cm)`}
                type="number"
                inputMode="decimal"
                placeholder="—"
                value={form.measurements[f]}
                onChange={(e) => setMeasurement(f, e.target.value)}
              />
            ))}
          </div>

          <TextArea
            label="Notes (optional)"
            rows={2}
            placeholder="Anything to remember about this check-in…"
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
          />

          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <BookOpen className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Every measurement here is optional — leave any field empty and you can add it at a
              future check-in.
            </p>
          </div>
        </div>
      )}

      {errors.save && (
        <p className="mt-4 text-[12px] text-red-400 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          {errors.save}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-5 mt-6 border-t border-white/[0.08]">
        {step > 0 ? (
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))}>
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <Button onClick={goNext}>
            Continue <ArrowRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? 'Saving baseline…' : 'Save Baseline'}
          </Button>
        )}
      </div>
    </Modal>
  );
}