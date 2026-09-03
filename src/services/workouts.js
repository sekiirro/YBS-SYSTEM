import { supabase } from '@/utils/supabase';

export const WorkoutsService = {
  async list(filters = {}) {
    let query = supabase
      .from('workout_plans')
      .select('*, workout_days(*, workout_exercises(*))')
      .eq('is_archived', false)
      .order('created_at', { ascending: false });

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
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('workout_plans')
      .select('*, workout_days(*, workout_exercises(*))')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(planPayload, days = []) {
    // 1. Insert plan header
    const { data: plan, error: planError } = await supabase
      .from('workout_plans')
      .insert(planPayload)
      .select()
      .single();
    if (planError) throw planError;

    // 2. Insert days and exercises if provided
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const { data: day, error: dayError } = await supabase
        .from('workout_days')
        .insert({
          workout_plan_id: plan.id,
          day_name: d.day_name,
          sort_order: i,
          rest_day: !!d.rest_day,
        })
        .select()
        .single();
      if (dayError) throw dayError;

      if (Array.isArray(d.exercises) && d.exercises.length > 0) {
        const exRecords = d.exercises.map((ex, exIdx) => ({
          workout_day_id: day.id,
          exercise_id: ex.exercise_id || null,
          exercise_name: ex.exercise_name || '',
          video_url: ex.video_url || null,
          sort_order: exIdx,
          sets: ex.sets || 3,
          rep_range: ex.rep_range || '8-12',
          rest_seconds: ex.rest_seconds || 60,
          target_weight: ex.weight || ex.target_weight || '',
          warmup: !!ex.warmup,
          rpe: ex.rpe || null,
          notes: ex.notes || null,
        }));
        const { error: exError } = await supabase
          .from('workout_exercises')
          .insert(exRecords);
        if (exError) throw exError;
      }
    }

    return this.getById(plan.id);
  },

  async update(id, planUpdates) {
    const { data, error } = await supabase
      .from('workout_plans')
      .update({ ...planUpdates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('workout_plans')
      .update({ is_archived: true })
      .eq('id', id);
    if (error) throw error;
    return true;
  }
};
