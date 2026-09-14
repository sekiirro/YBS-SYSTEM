import { supabase } from '@/utils/supabase';

// True when the row belongs to the YBS Global Library.
// Prefers the explicit generated flag; falls back to the underlying
// representation (workspace_id IS NULL) for remotes where the
// migration has not been applied yet. Never uses hardcoded IDs.
export function isGlobalExercise(exercise) {
  if (!exercise) return false;
  if (exercise.is_global === true) return true;
  if (exercise.is_global === false) return false;
  return exercise.workspace_id == null;
}

export const ExercisesService = {
  // Global Exercise Library: every workspace sees
  //   own workspace exercises (workspace_id = <ws>)
  //   + YBS global exercises (workspace_id IS NULL / is_global = true).
  // Workspace isolation is preserved: no other workspace's rows are
  // ever returned. RLS (exercises_select) enforces the same boundary
  // server-side; this query only shapes the client request.
  // workspaceId === null/undefined → previous behavior (all accessible
  // non-archived exercises).
  async list(workspaceId) {
    let query = supabase
      .from('exercises')
      .select('*')
      .eq('is_archived', false);
    if (workspaceId) {
      // PostgREST OR: workspace-owned OR global. Resilient to remotes
      // where the generated is_global column is not yet present —
      // workspace_id.is.null covers the same rows.
      query = query.or(`workspace_id.eq.${workspaceId},workspace_id.is.null`);
    }
    const { data, error } = await query.order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('exercises')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('exercises')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('exercises')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('exercises')
      .update({ is_archived: true })
      .eq('id', id);
    if (error) throw error;
    return true;
  }
};
