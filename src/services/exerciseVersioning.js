import { supabase } from '@/utils/supabase';

/**
 * Platform-level exercise identity + workspace version resolution.
 *
 * Every logical exercise belongs to a canonical_exercises row; concrete
 * exercise rows are linked to it per workspace via exercise_mappings
 * (workspace_id NULL = the YBS Global version). At TEMPLATE LOAD TIME the
 * app resolves each template exercise to the target workspace's version
 * (falling back to the YBS Global version, then to the original row).
 * Resolution is a load-time concern — already-assigned plans are never
 * rewritten retroactively.
 *
 * Mappings are managed exclusively by the Platform Owner through the
 * "Link exercise versions" UI; every read/write goes through SECURITY
 * DEFINER RPCs so workspace members consume without busting RLS.
 */
export const ExerciseVersioningService = {
  /**
   * Resolve every exercise of `planId` against `targetWorkspaceId`.
   * Returns the resolution rows keyed by workout_exercises.id plus the
   * resolved exercise rows (fetched in one batched query).
   *
   * @param {string} planId
   * @param {string} targetWorkspaceId
   * @returns {Promise<{ resolutions: Array, exercisesById: Object }>}
   */
  async resolvePlanForWorkspace(planId, targetWorkspaceId) {
    const { data, error } = await supabase.rpc('resolve_exercise_versions_for_plan', {
      p_plan_id: planId,
      p_target_workspace_id: targetWorkspaceId || null,
    });
    if (error) throw error;

    const resolutions = data || [];

    const resolvedIds = [...new Set(
      (resolutions || [])
        .map((r) => r.resolved_exercise_id)
        .filter(Boolean)
    )];

    let exercisesById = {};
    if (resolvedIds.length > 0) {
      const { data: exercises, error: exError } = await supabase
        .from('exercises')
        .select('id, name, category, muscle_group, equipment, video_url, workspace_id')
        .in('id', resolvedIds);
      if (exError) throw exError;
      exercisesById = Object.fromEntries((exercises || []).map((e) => [e.id, e]));
    }

    return { resolutions, exercisesById };
  },

  /**
   * Apply a resolution result onto a formatted plan's days. Replaces the
   * exercise identity fields (id/name/video/category/…) while preserving
   * every programming column (sets, reps, RIR/RPE, rest, warm-up, notes,
   * order, group/superset metadata). Adds `_versionInfo` meta so the UI can
   * flag "Not Linked" rows; harmless for persistence.
   *
   * @param {Array} days formatted plan days (WorkoutsService shape)
   * @param {Object} exercisesById resolved exercise rows by id
   * @param {Array} resolutions RPC rows keyed by workout_exercise_id
   */
  applyResolution(days, exercisesById, resolutions) {
    if (!Array.isArray(days)) return days || [];
    const byId = new Map((resolutions || []).map((r) => [r.workout_exercise_id, r]));

    return days.map((day) => {
      if (day.day_type === 'rest_day' || !!day.rest_day) return day;
      const exercises = (day.exercises || []).map((ex) => {
        const res = byId.get(ex.id);
        if (!res) return ex;

        const resolved = exercisesById?.[res.resolved_exercise_id];
        const base = {
          _versionInfo: {
            linked: !!res.linked,
            canonical_exercise_id: res.canonical_exercise_id || null,
            original_exercise_id: res.original_exercise_id ?? null,
          },
        };
        if (!resolved || resolved.id === ex.exercise_id) return { ...ex, ...base };

        return {
          ...ex,
          ...base,
          exercise_id: resolved.id,
          exercise_name: resolved.name || ex.exercise_name,
          video_url: resolved.video_url ?? ex.video_url ?? null,
          category: resolved.category || ex.category || 'other',
          muscle_group: resolved.muscle_group || ex.muscle_group || null,
          equipment: resolved.equipment || ex.equipment || null,
          exercise: resolved,
        };
      });
      return { ...day, exercises };
    });
  },

  // ─── Platform-Owner linking (modal data + mutations) ────────────────

  /** Full canonical → version matrix (platform owner only, RPC-gated). */
  async listMappings() {
    const { data, error } = await supabase.rpc('list_exercise_mappings');
    if (error) throw error;
    return data || [];
  },

  /**
   * Apply a batch of link/unlink operations.
   * @param {Array} items { canonical_exercise_id?, canonical_name?, exercise_id?, workspace_id? }
   */
  async linkVersions(items) {
    const { data, error } = await supabase.rpc('link_exercise_versions', {
      p_items: items || [],
    });
    if (error) throw error;
    return data;
  },
};