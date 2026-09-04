import { supabase } from '@/utils/supabase';

/**
 * Pure calculation helper for YBS Workout Volume.
 *
 * RULE:
 * Total Volume = Number of Working Sets.
 * NOT reps × weight, NOT tonnage.
 * Warm-up sets are excluded from volume. The DB row model represents
 * warm-up at the row level only, via the whole-exercise `warmup` flag
 * (there is NO warmup_sets column); the builder may still author a
 * warmup_sets count in memory, but persistence stores total sets +
 * working_sets + the row-level warmup flag.
 *
 * Attribution:
 * Each working set is attributed to the exercise's primary muscle category:
 * ('chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio', 'full_body', 'other').
 */
export function calculateWorkoutVolume(days = []) {
  let totalWorkingSets = 0;
  const sessionVolumes = [];
  const muscleCounts = {};

  (days || []).forEach((day, dayIdx) => {
    let sessionSets = 0;
    const exercises = day.exercises || day.workout_exercises || [];

    exercises.forEach((ex) => {
      // Prefer explicit working_sets field when available
      let workingSetsCount;
      if (ex.working_sets !== undefined) {
        workingSetsCount = Number(ex.working_sets) || 0;
      } else {
        // Legacy fallback: derive from sets - warmup_sets
        const setsCount = Number(ex.sets) || 0;
        const warmupSetsCount = Number(ex.warmup_sets) || 0;
        const isWarmup = !!ex.warmup;
        workingSetsCount = isWarmup ? 0 : (setsCount - warmupSetsCount);
      }

      if (workingSetsCount > 0) {
        sessionSets += workingSetsCount;
        totalWorkingSets += workingSetsCount;

        // Determine muscle category from canonical exercise reference or inline tag
        const category = (
          ex.exercise?.category ||
          ex.category ||
          ex.exercise?.muscle_group ||
          ex.muscle_group ||
          'other'
        ).toLowerCase();

        muscleCounts[category] = (muscleCounts[category] || 0) + workingSetsCount;
      }
    });

    sessionVolumes.push({
      dayIndex: dayIdx,
      dayName: day.day_name || `Day ${dayIdx + 1}`,
      workingSets: sessionSets,
      totalExercises: exercises.length,
      restDay: !!day.rest_day,
    });
  });

  const muscleDistribution = Object.entries(muscleCounts)
    .map(([muscle, sets]) => ({
      muscle,
      sets,
      percentage: totalWorkingSets > 0 ? Math.round((sets / totalWorkingSets) * 100) : 0,
    }))
    .sort((a, b) => b.sets - a.sets);

  return {
    totalWorkingSets,
    sessionVolumes,
    muscleCounts,
    muscleDistribution,
  };
}

/**
 * Formats a raw Supabase plan record with sorted days and exercises.
 */
function formatPlan(p) {
  if (!p) return null;
  const days = (p.workout_days || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const formattedDays = days.map((d) => {
    const exercises = (d.workout_exercises || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return {
      ...d,
      exercises: exercises.map((ex) => ({
        ...ex,
        category: ex.exercises?.category || ex.category || null,
        muscle_group: ex.exercises?.muscle_group || ex.muscle_group || null,
        equipment: ex.exercises?.equipment || ex.equipment || null,
        exercise: ex.exercises || null,
      })),
    };
  });

  const volume = calculateWorkoutVolume(formattedDays);

  return {
    ...p,
    days: formattedDays,
    workout_days: formattedDays,
    client_name: p.clients?.full_name || null,
    client_code: p.clients?.client_code || null,
    total_working_sets: volume.totalWorkingSets,
    session_volumes: volume.sessionVolumes,
    muscle_distribution: volume.muscleDistribution,
  };
}

export const WorkoutsService = {
  calculateWorkoutVolume,

  async list(filters = {}) {
    let query = supabase
      .from('workout_plans')
      .select(`
        *,
        clients (id, full_name, client_code),
        workout_days (
          *,
          workout_exercises (
            *,
            exercises (id, name, category, muscle_group, equipment, video_url)
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (filters.is_archived !== undefined) {
      query = query.eq('is_archived', filters.is_archived);
    } else {
      query = query.eq('is_archived', false);
    }

    if (filters.client_id) {
      query = query.eq('client_id', filters.client_id);
    }
    if (filters.workspace_id) {
      query = query.eq('workspace_id', filters.workspace_id);
    }
    if (filters.is_template !== undefined) {
      query = query.eq('is_template', filters.is_template);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(formatPlan);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('workout_plans')
      .select(`
        *,
        clients (id, full_name, client_code),
        workout_days (
          *,
          workout_exercises (
            *,
            exercises (id, name, category, muscle_group, equipment, video_url, instructions)
          )
        )
      `)
      .eq('id', id)
      .single();
    if (error) throw error;
    return formatPlan(data);
  },

  /**
   * Creates a new workout plan with days and exercises.
   */
  async create(planPayload, days = []) {
    const { data: plan, error: planError } = await supabase
      .from('workout_plans')
      .insert({
        ...planPayload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (planError) throw planError;

    await this._insertDaysAndExercises(plan.id, days);
    return this.getById(plan.id);
  },

  /**
   * Updates an existing workout plan.
   * If days array is supplied, cascade-replaces previous days and exercises.
   */
  async update(id, planPayload, days = null) {
    const updates = {
      ...planPayload,
      updated_at: new Date().toISOString(),
    };

    const { data: plan, error: planError } = await supabase
      .from('workout_plans')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (planError) throw planError;

    if (days && Array.isArray(days)) {
      // Delete old days (cascade will delete workout_exercises)
      const { error: delError } = await supabase
        .from('workout_days')
        .delete()
        .eq('workout_plan_id', id);
      if (delError) throw delError;

      await this._insertDaysAndExercises(id, days);
    }

    return this.getById(id);
  },

  /**
   * Helper to insert days and their exercises.
   */
  async _insertDaysAndExercises(planId, days) {
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const { data: day, error: dayError } = await supabase
        .from('workout_days')
        .insert({
          workout_plan_id: planId,
          day_name: d.day_name || `Day ${i + 1}`,
          sort_order: i,
          rest_day: !!d.rest_day,
          notes: d.notes || null,
        })
        .select()
        .single();
      if (dayError) throw dayError;

      const exercises = d.exercises || d.workout_exercises || [];
      if (Array.isArray(exercises) && exercises.length > 0) {
        const exRecords = exercises.map((ex, exIdx) => {
          const warmupSets = Number(ex.warmup_sets) || 0;
          const workingSets = Number(ex.working_sets) || 0;
          const totalSets = warmupSets + workingSets;
          return {
            workout_day_id: day.id,
            exercise_id: ex.exercise_id || null,
            exercise_name: ex.exercise_name || ex.name || '',
            video_url: ex.video_url || null,
            sort_order: exIdx,
            // NOTE: warmup_sets is UI-only state; workout_exercises has no
            // such column. Total sets and the working count are persisted,
            // and the row-level `warmup` flag is set only when the ENTIRE
            // exercise is a warm-up (no working sets) so volume consumers
            // that shortcut on `warmup` stay correct for mixed rows.
            working_sets: workingSets,
            sets: totalSets || 3,
            rep_range: String(ex.rep_range || '8-12'),
            rest_seconds: Number(ex.rest_seconds) || 60,
            target_weight: ex.target_weight || null,
            warmup: warmupSets > 0 && workingSets === 0,
            rpe: ex.rpe ? Number(ex.rpe) : null,
            notes: ex.notes || null,
            group_id: ex.group_id || null,
            group_type: ex.group_type || null,
            prescribed_sets_detail: Array.isArray(ex.prescribed_sets_detail) ? ex.prescribed_sets_detail : [],
          };
        });

        const { error: exError } = await supabase
          .from('workout_exercises')
          .insert(exRecords);
        if (exError) throw exError;
      }
    }
  },

  /**
   * Assigns a plan or template to a client by making an independent snapshot copy.
   * Modifying templates later will NEVER mutate active client programs.
   */
  async assignToClient(planOrId, clientId, overrides = {}) {
    const sourcePlan = typeof planOrId === 'string'
      ? await this.getById(planOrId)
      : planOrId;

    if (!sourcePlan) throw new Error('Source workout plan not found');

    const newPlanPayload = {
      workspace_id: overrides.workspace_id || sourcePlan.workspace_id,
      client_id: clientId,
      assigned_ybs_coach_id: overrides.assigned_ybs_coach_id || sourcePlan.assigned_ybs_coach_id,
      name: overrides.name || sourcePlan.name,
      split_type: sourcePlan.split_type,
      custom_split_name: sourcePlan.custom_split_name || null,
      is_template: false,
      source_template_id: sourcePlan.is_template ? sourcePlan.id : null,
      notes: overrides.notes !== undefined ? overrides.notes : sourcePlan.notes,
    };

    return this.create(newPlanPayload, sourcePlan.days || []);
  },

  /**
   * Saves any plan as a reusable Template.
   */
  async saveAsTemplate(planOrId, templateName, overrides = {}) {
    const sourcePlan = typeof planOrId === 'string'
      ? await this.getById(planOrId)
      : planOrId;

    if (!sourcePlan) throw new Error('Source workout plan not found');

    const templatePayload = {
      workspace_id: overrides.workspace_id || sourcePlan.workspace_id,
      client_id: null,
      name: templateName || `${sourcePlan.name} (Template)`,
      split_type: sourcePlan.split_type,
      custom_split_name: sourcePlan.custom_split_name || null,
      is_template: true,
      notes: sourcePlan.notes || null,
    };

    return this.create(templatePayload, sourcePlan.days || []);
  },

  async delete(id) {
    const { error } = await supabase
      .from('workout_plans')
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  // ─── Client Workout Execution / Tracking ───────────────────────────

  async startWorkoutLog({ workspace_id, client_id, workout_plan_id, workout_day_id, session_name, notes }) {
    const { data, error } = await supabase
      .from('workout_logs')
      .insert({
        workspace_id,
        client_id,
        workout_plan_id: workout_plan_id || null,
        workout_day_id: workout_day_id || null,
        session_name: session_name || 'Workout Session',
        performed_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        status: 'in_progress',
        notes: notes || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async logSet(setPayload) {
    const { data, error } = await supabase
      .from('workout_set_logs')
      .insert({
        workout_log_id: setPayload.workout_log_id,
        workout_exercise_id: setPayload.workout_exercise_id || null,
        exercise_id: setPayload.exercise_id || null,
        exercise_name: setPayload.exercise_name,
        set_number: Number(setPayload.set_number) || 1,
        is_warmup: !!setPayload.is_warmup,
        weight_kg: setPayload.weight_kg ? Number(setPayload.weight_kg) : null,
        reps_completed: setPayload.reps_completed ? Number(setPayload.reps_completed) : null,
        rpe: setPayload.rpe ? Number(setPayload.rpe) : null,
        completed: setPayload.completed !== undefined ? !!setPayload.completed : true,
        notes: setPayload.notes || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async completeWorkoutLog(logId, { duration_seconds, notes, status = 'completed' } = {}) {
    const { data, error } = await supabase
      .from('workout_logs')
      .update({
        completed_at: new Date().toISOString(),
        duration_seconds: duration_seconds || null,
        notes: notes || null,
        status,
      })
      .eq('id', logId)
      .select('*, workout_set_logs(*)')
      .single();
    if (error) throw error;
    return data;
  },

  async getClientWorkoutHistory(clientId, limit = 20) {
    const { data, error } = await supabase
      .from('workout_logs')
      .select('*, workout_set_logs(*)')
      .eq('client_id', clientId)
      .order('performed_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },
};
