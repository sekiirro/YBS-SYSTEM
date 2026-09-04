import { supabase } from '@/utils/supabase';

export const FoodsService = {
  async list() {
    const { data, error } = await supabase
      .from('foods')
      .select('*')
      .eq('is_archived', false)
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('foods')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('foods')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('foods')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('foods')
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return true;
  }
};
