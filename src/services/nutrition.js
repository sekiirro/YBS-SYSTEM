import { supabase } from '@/utils/supabase';

export const NutritionService = {
  async list(filters = {}) {
    let query = supabase
      .from('nutrition_plans')
      .select('*, nutrition_meals(*, nutrition_items(*))')
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
      .from('nutrition_plans')
      .select('*, nutrition_meals(*, nutrition_items(*))')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(planPayload, meals = []) {
    // 1. Insert plan
    const { data: plan, error: planError } = await supabase
      .from('nutrition_plans')
      .insert(planPayload)
      .select()
      .single();
    if (planError) throw planError;

    // 2. Insert meals and items if provided
    for (let i = 0; i < meals.length; i++) {
      const m = meals[i];
      const { data: meal, error: mealError } = await supabase
        .from('nutrition_meals')
        .insert({
          nutrition_plan_id: plan.id,
          meal_name: m.meal_name,
          sort_order: i,
          calories: m.calories || null,
          notes: m.notes || null,
        })
        .select()
        .single();
      if (mealError) throw mealError;

      if (Array.isArray(m.items) && m.items.length > 0) {
        const itemRecords = m.items.map((it) => ({
          meal_id: meal.id,
          food_id: it.food_id || null,
          food_name: it.food_name || '',
          amount: it.quantity || it.amount || 100,
          unit: it.unit || 'g',
          calories: it.calories || 0,
          protein: it.protein || 0,
          carbs: it.carbs || 0,
          fat: it.fat || 0,
        }));
        const { error: itemError } = await supabase
          .from('nutrition_items')
          .insert(itemRecords);
        if (itemError) throw itemError;
      }
    }

    return this.getById(plan.id);
  },

  async update(id, planUpdates) {
    const { data, error } = await supabase
      .from('nutrition_plans')
      .update({ ...planUpdates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('nutrition_plans')
      .update({ is_archived: true })
      .eq('id', id);
    if (error) throw error;
    return true;
  }
};
