import { supabase } from '@/utils/supabase';

export const ExercisesService = {
  // workspaceId === null/undefined → previous behavior (all accessible
  // non-archived exercises). When a workspaceId is provided the library
  // is scoped to exercises owned by that workspace. Server-side RLS
  // enforces the same isolation for direct API access.
  async list(workspaceId) {
    let query = supabase
      .from('exercises')
      .select('*')
      .eq('is_archived', false);
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
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
