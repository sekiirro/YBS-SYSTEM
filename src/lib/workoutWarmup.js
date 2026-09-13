// Centralized warm-up guidance for the trainee workout interface.
// This is an instruction/education layer ONLY. The app never calculates or
// prescribes an actual warm-up weight — trainees always enter the load they used.
// The instruction references the trainee's own working-set weight by percentage.

export const WARMUP_PERCENTAGES = {
  2: [60, 80],
  3: [40, 60, 80],
};

function splitSets(ex = {}) {
  const totalSets = Number(ex.sets) || 0;
  const workingSets =
    ex.working_sets !== undefined
      ? Number(ex.working_sets) || 0
      : ex.warmup
      ? 0
      : totalSets;
  return {
    warmupCount: Math.max(0, totalSets - workingSets),
    workingCount: workingSets,
  };
}

export function getWarmupCount(ex) {
  return splitSets(ex).warmupCount;
}

export function getWarmupNote(ex = {}, setNumber) {
  const { warmupCount, workingCount } = splitSets(ex);
  if (setNumber < 1 || setNumber > warmupCount) return null;
  if (workingCount <= 0) return null;
  const list = WARMUP_PERCENTAGES[warmupCount];
  const pct = list ? list[setNumber - 1] : null;
  if (pct == null) return null;
  return `Use approximately ${pct}% of your working-set weight.`;
}