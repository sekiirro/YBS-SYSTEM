// Single domain-level config + helpers for the Body Progress tracking system.
// Import from here in components so threshold tables, image paths, method
// vocabularies, units, validation ranges, derived metrics and baseline
// completeness rules live in ONE coherent module.

export const UNITS = {
  weight: 'kg',
  height: 'cm',
  circumference: 'cm',
  bodyFat: '%',
  age: 'yrs',
};

// ---------------------------------------------------------------------------
// Body fat visual-estimate slider assets (portrait photographs baked into the
// repo under public/body-fat). Matches Desktop/YBS_Body_Fat_Assets_Review.
// ---------------------------------------------------------------------------
export const BODY_FAT_SLIDER_THRESHOLDS = {
  male: [10, 12, 15, 18, 20, 22, 25, 28, 30, 32, 35, 40],
  female: [18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 42, 45, 50],
};

export const BODY_FAT_SLIDER_IMAGES = Object.fromEntries(
  Object.entries(BODY_FAT_SLIDER_THRESHOLDS).map(([sex, thresholds]) => [
    sex,
    Object.fromEntries(thresholds.map((value) => [value, `/body-fat/${sex}/${value}.png`])),
  ])
);

export const BODY_FAT_METHODS = {
  visual_estimate: {
    label: 'Visual estimate (guide photos)',
    shortLabel: 'Visual estimate',
    description: 'Estimated from the reference guide photos — approximate, do not confuse with a measured value.',
  },
  manual_entry: {
    label: 'Manual entry',
    shortLabel: 'Manual entry',
    description: 'A body-fat value you already have from an external source.',
  },
  navy_estimate: {
    label: 'U.S. Navy method',
    shortLabel: 'Navy method',
    description: 'Calculated from circumference measurements using the U.S. Navy formula.',
  },
  bia: {
    label: 'Bioelectrical impedance (BIA scale)',
    shortLabel: 'BIA scale',
    description: 'From a smart scale or hand-held device.',
  },
  skinfold: {
    label: 'Skinfold calipers',
    shortLabel: 'Caliper',
    description: 'Measured with skinfold calipers by a qualified professional.',
  },
  dexa: {
    label: 'DEXA scan',
    shortLabel: 'DEXA',
    description: 'Gold-standard measurement from a DEXA scan.',
  },
  other: {
    label: 'Other / clinical',
    shortLabel: 'Other',
    description: 'Any other clinical or professional measurement method.',
  },
};

export const BODY_FAT_METHOD_ORDER = [
  'visual_estimate',
  'manual_entry',
  'navy_estimate',
  'bia',
  'skinfold',
  'dexa',
  'other',
];

// ---------------------------------------------------------------------------
// Validation ranges (mirrors the server-side save_metrics_baseline checks).
// ---------------------------------------------------------------------------
export const VALIDATION_RANGES = {
  height: { min: 90, max: 260, label: 'Height', unit: UNITS.height },
  weight: { min: 25, max: 400, label: 'Weight', unit: UNITS.weight },
  body_fat: { min: 0, max: 75, label: 'Body fat', unit: UNITS.bodyFat },
  neck: { min: 5, max: 300, label: 'Neck', unit: UNITS.circumference },
  chest: { min: 5, max: 300, label: 'Chest', unit: UNITS.circumference },
  waist: { min: 5, max: 300, label: 'Waist', unit: UNITS.circumference },
  hip: { min: 5, max: 300, label: 'Hip', unit: UNITS.circumference },
  right_arm: { min: 5, max: 300, label: 'Arm (R)', unit: UNITS.circumference },
  left_arm: { min: 5, max: 300, label: 'Arm (L)', unit: UNITS.circumference },
  right_thigh: { min: 5, max: 300, label: 'Thigh (R)', unit: UNITS.circumference },
  left_thigh: { min: 5, max: 300, label: 'Thigh (L)', unit: UNITS.circumference },
  right_calf: { min: 5, max: 300, label: 'Calf (R)', unit: UNITS.circumference },
  left_calf: { min: 5, max: 300, label: 'Calf (L)', unit: UNITS.circumference },
};

// Optional circumference fields collected during baseline / check-ins.
export const CIRCUMFERENCE_FIELDS = [
  'neck',
  'chest',
  'waist',
  'hip',
  'right_arm',
  'left_arm',
  'right_thigh',
  'left_thigh',
  'right_calf',
  'left_calf',
];

export const MEASURING_GUIDE_URL = 'https://www.youtube.com/watch?v=FKRJfnZMKiM';

// ---------------------------------------------------------------------------
// Derivated body-composition metrics (computed, never persisted).
// ---------------------------------------------------------------------------
export function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function calculateDerived(row = {}, heightSource = null) {
  const weight = toNumber(row?.weight);
  const height = toNumber(row?.height) || toNumber(heightSource);
  const bodyFat = toNumber(row?.body_fat);
  const waist = toNumber(row?.waist);

  let bmi = null;
  let fatMass = null;
  let leanMass = null;
  let ffmi = null;
  let waistHeightRatio = null;

  if (weight != null && height != null && height > 0) {
    const heightM = height / 100;
    bmi = weight / (heightM * heightM);
  }
  if (weight != null && bodyFat != null) {
    fatMass = weight * (bodyFat / 100);
    leanMass = weight - fatMass;
  }
  if (leanMass != null && height != null && height > 0) {
    const heightM = height / 100;
    ffmi = leanMass / (heightM * heightM);
  }
  if (waist != null && height != null && height > 0) {
    waistHeightRatio = waist / height;
  }

  return {
    bmi: bmi == null ? null : round1(bmi),
    fatMass: fatMass == null ? null : round1(fatMass),
    leanMass: leanMass == null ? null : round1(leanMass),
    ffmi: ffmi == null ? null : round1(ffmi),
    waistHeightRatio: waistHeightRatio == null ? null : round2(waistHeightRatio),
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers.
// ---------------------------------------------------------------------------
export function fmtNum(value, digits = 1) {
  const n = toNumber(value);
  if (n == null) return '—';
  return Number(n.toFixed(digits)).toString();
}

export function fmtMetric(field, row, heightSource) {
  const raw = toNumber(row?.[field]);
  if (raw == null) return null;
  const range = VALIDATION_RANGES[field];
  const unit = range?.unit || '';
  return { value: fmtNum(raw), unit, raw };
}

export function weightLabel(value, unit = UNITS.weight) {
  const raw = toNumber(value);
  if (raw == null) return '—';
  return `${fmtNum(raw)} ${unit}`;
}

export function bodyFatLabel(value) {
  const raw = toNumber(value);
  if (raw == null) return '—';
  return `${fmtNum(raw)}%`;
}

export function cmLabel(value) {
  const raw = toNumber(value);
  if (raw == null) return '—';
  return `${fmtNum(raw)} cm`;
}

// ---------------------------------------------------------------------------
// Baseline data-driven gate + prefill.
//
// Required: sex, age (date of birth), height, weight — each sourced first from
// the client profile (clients table), then fall back to the persisted baseline
// or latest metric row (never invented). Body fat is optional (can be skipped).
// ---------------------------------------------------------------------------
const REQUIRED_BASELINE_FIELDS = ['sex', 'age', 'height', 'weight'];

export function computeAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

// Sourced order: client profile -> baseline row -> latest row.
function sourceValue(field, client, baseline, latest, profileMatcher) {
  const profileVal = profileMatcher ? profileMatcher(client) : null;
  if (profileVal != null && profileVal !== '') return profileVal;
  if (baseline && baseline[field] != null && baseline[field] !== '') return baseline[field];
  if (latest && latest[field] != null && latest[field] !== '') return latest[field];
  return null;
}

export function getBaselineState(state) {
  const client = state?.client || {};
  const baseline = state?.baseline || null;
  const latest = state?.latest || null;

  const resolved = {
    sex: sourceValue('', client, baseline, latest, (c) => c.gender),
    date_of_birth: sourceValue('', client, baseline, latest, (c) => c.date_of_birth),
    age: computeAge(
      sourceValue('', client, baseline, latest, (c) => c.date_of_birth)
    ),
    height: sourceValue('height', client, baseline, latest, (c) => c.height),
    weight: sourceValue('weight', client, baseline, latest, (c) => c.current_weight),
    body_fat: sourceValue('body_fat', client, baseline, latest, () => null),
    body_fat_method: baseline?.body_fat_method || null,
  };

  const missing = new Set();
  if (!resolved.sex) missing.add('sex');
  if (!resolved.age) missing.add('age');
  if (resolved.height == null) missing.add('height');
  if (resolved.weight == null) missing.add('weight');

  return {
    ...resolved,
    missing,
    missingList: REQUIRED_BASELINE_FIELDS.filter((f) => missing.has(f)),
    complete: missing.size === 0,
    hasBaseline: !!state?.has_baseline,
    metricCount: state?.metric_count || 0,
    baselineRow: baseline,
  };
}

// Which optional circumferences were never recorded on any entry.
export function getMissingMeasurements(rows = []) {
  const present = new Set();
  rows.forEach((row) => {
    CIRCUMFERENCE_FIELDS.forEach((f) => {
      if (row[f] != null && row[f] !== '') present.add(f);
    });
  });
  return CIRCUMFERENCE_FIELDS.filter((f) => !present.has(f));
}

export function getBodyFatMethodLabel(method) {
  if (!method) return null;
  return BODY_FAT_METHODS[method]?.shortLabel || method.replace(/_/g, ' ');
}

// round helpers used above
function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}