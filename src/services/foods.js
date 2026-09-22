import { supabase } from '@/utils/supabase';

// Foods is static reference data read repeatedly (food pickers open on every
// meal edit). A short in-memory cache avoids refetching the whole library on
// each open while staying bounded: any create/update/delete clears it so users
// never see stale data after their own (or another session's) mutations.
const FOODS_CACHE_TTL = 60 * 1000;
let foodsCache = { ts: 0, data: null };

const invalidateFoodsCache = () => {
  foodsCache = { ts: 0, data: null };
};

export const FoodsService = {
  async list() {
    const now = Date.now();
    if (foodsCache.data && now - foodsCache.ts < FOODS_CACHE_TTL) return foodsCache.data;
    const { data, error } = await supabase
      .from('foods')
      .select('*')
      .eq('is_archived', false)
      .order('name', { ascending: true });
    if (error) throw error;
    foodsCache = { ts: now, data: data || [] };
    return foodsCache.data;
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
    invalidateFoodsCache();
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
    invalidateFoodsCache();
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('foods')
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    invalidateFoodsCache();
    return true;
  }
};
