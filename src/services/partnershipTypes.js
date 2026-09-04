import { supabase } from '@/utils/supabase';

export const PartnershipTypesService = {
  async list() {
    const { data, error } = await supabase
      .from('partnership_types')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async listAll() {
    const { data, error } = await supabase
      .from('partnership_types')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('partnership_types')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }
};
