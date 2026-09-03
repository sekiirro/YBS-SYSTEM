import { supabase } from '@/utils/supabase';

export const PackagesService = {
  async list(workspaceId = null) {
    let query = supabase
      .from('packages')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true });

    if (workspaceId) {
      query = query.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    } else {
      query = query.is('workspace_id', null);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('packages')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('packages')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('packages')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  }
};
