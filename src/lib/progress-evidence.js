const EXERCISE_GROUPS = [
  { id: 'bench', label: 'CHEST / BENCH', keywords: ['bench', 'chest'] },
  { id: 'lat', label: 'LAT', keywords: ['lat'] },
  { id: 'upper_back', label: 'UPPER BACK', keywords: ['upper back', 't-bar row'] },
  { id: 'leg_extension', label: 'LEG EXTENSION', keywords: ['leg extensions', 'leg extension'] },
  { id: 'leg_curl', label: 'LEG CURL', keywords: ['leg curl'] },
  { id: 'biceps', label: 'BICEPS', keywords: ['biceps'] },
  { id: 'triceps', label: 'TRICEPS', keywords: ['triceps'] },
  { id: 'lateral_raise', label: 'LATERAL RAISE', keywords: ['lateral raises', 'lateral raise'] },
];

const MEASUREMENTS = [
  ['waist', 'WAIST'], ['chest', 'CHEST'], ['right_arm', 'RIGHT ARM'], ['left_arm', 'LEFT ARM'],
  ['right_thigh', 'RIGHT THIGH'], ['left_thigh', 'LEFT THIGH'], ['right_calf', 'RIGHT CALF'],
  ['left_calf', 'LEFT CALF'], ['hip', 'HIPS'], ['neck', 'NECK'],
];

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const chronological = (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime();

function metricSeries(rows, field) {
  return (rows || []).map((row) => ({ date: row.entry_date, value: number(row[field]) }))
    .filter((point) => point.date && point.value != null).sort(chronological);
}

function summarize(id, title, unit, points, meta = {}) {
  if (!points.length) return null;
  const first = points[0];
  const current = points[points.length - 1];
  return { id, title, unit, points, first: first.value, current: current.value, change: Math.round((current.value - first.value) * 100) / 100, ...meta };
}

function trainingEvidence(workoutLogs = []) {
  const byExercise = new Map();
  workoutLogs.filter((log) => log?.status === 'completed' && log?.performed_at).forEach((log) => {
    const perSession = new Map();
    (log.workout_set_logs || []).forEach((set) => {
      const name = String(set.exercise_name || '').trim();
      const weight = number(set.weight_kg);
      if (!name || !set.completed || set.is_warmup || weight == null || weight <= 0) return;
      const key = name.toLowerCase().replace(/\s+/g, ' ');
      const existing = perSession.get(key);
      if (!existing || weight > existing.value) perSession.set(key, { name, value: weight });
    });
    perSession.forEach(({ name, value }, key) => {
      if (!byExercise.has(key)) byExercise.set(key, { name, points: [] });
      byExercise.get(key).points.push({ date: log.performed_at, value });
    });
  });

  return EXERCISE_GROUPS.flatMap((group) => {
    const matches = [...byExercise.values()].filter(({ name }) => group.keywords.some((word) => name.toLowerCase().includes(word)));
    if (!matches.length) return [];
    const selected = matches.sort((a, b) => b.points.length - a.points.length || new Date(b.points.at(-1)?.date) - new Date(a.points.at(-1)?.date))[0];
    const points = selected.points.sort(chronological);
    return [summarize(`training-${group.id}`, selected.name.toUpperCase(), 'kg', points, { type: 'training', group: group.label, sufficient: points.length >= 2 })];
  }).filter(Boolean);
}

export function buildProgressEvidence({ metrics = [], workoutLogs = [], nutritionLogs = [] }) {
  const weight = summarize('weight', 'WEIGHT', 'kg', metricSeries(metrics, 'weight'), { type: 'weight', sufficient: true });
  const measurements = MEASUREMENTS.map(([field, label]) => summarize(`measurement-${field}`, label, 'cm', metricSeries(metrics, field), { type: 'measurement', sufficient: metricSeries(metrics, field).length >= 2 })).filter((item) => item?.sufficient);
  const bodyFatPoints = metricSeries(metrics, 'body_fat');
  const bodyFat = bodyFatPoints.length >= 2 ? summarize('body-fat', 'BODY FAT', '%', bodyFatPoints, { type: 'body-fat', sufficient: true }) : null;
  const nutritionPoints = (nutritionLogs || []).filter((log) => log?.log_date).map((log) => ({ date: log.log_date, value: log.meals_completed ? 100 : 0 })).sort(chronological);
  const nutrition = nutritionPoints.length >= 2 ? summarize('nutrition', 'NUTRITION ADHERENCE', '%', nutritionPoints, { type: 'nutrition', sufficient: true }) : null;
  return [weight, ...trainingEvidence(workoutLogs), ...measurements, bodyFat, nutrition].filter(Boolean);
}

