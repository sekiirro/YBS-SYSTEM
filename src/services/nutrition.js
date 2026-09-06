import { supabase } from '@/utils/supabase';
import { getLocalDateKey } from '@/lib/ybs-utils';

// ─── Plan / Meal Normalizer ─────────────────────────────────────────

function formatPlan(p) {
  if (!p) return null;
  const rawMeals = p.nutrition_meals || p.meals || [];
  const sortedMeals = [...rawMeals].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const meals = sortedMeals.map((m) => {
    const rawItems = m.nutrition_items || m.items || [];
    return {
      ...m,
      day_number: m.day_number || 1,
      items: rawItems.map((it) => ({
        ...it,
        amount: Number(it.amount) || 0,
        unit: it.unit || 'g',
        calories: Number(it.calories) || 0,
        protein: Number(it.protein) || 0,
        carbs: Number(it.carbs) || 0,
        fat: Number(it.fat) || 0,
        base_food: it.foods || it.base_food || null,
      })),
      nutrition_items: rawItems,
    };
  });

  return {
    ...p,
    client_name: p.clients?.full_name || p.client_name || null,
    client_code: p.clients?.client_code || p.client_code || null,
    daily_calories: p.daily_calories != null ? Number(p.daily_calories) : null,
    daily_protein: p.daily_protein != null ? Number(p.daily_protein) : null,
    daily_carbs: p.daily_carbs != null ? Number(p.daily_carbs) : null,
    daily_fat: p.daily_fat != null ? Number(p.daily_fat) : null,
    meals,
    nutrition_meals: meals,
  };
}

// ─── Pure Calculation Helpers ───────────────────────────────────────

/**
 * Calculates sum of calories and macros across all meals and items.
 * @param {Array} meals - List of meals containing items[]
 * @returns {{ calories: number, protein: number, carbs: number, fat: number }}
 */
export function calculatePlanTotals(meals = []) {
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;

  for (const meal of meals) {
    const items = meal.items || meal.nutrition_items || [];
    for (const it of items) {
      calories += Number(it.calories) || 0;
      protein += Number(it.protein) || 0;
      carbs += Number(it.carbs) || 0;
      fat += Number(it.fat) || 0;
    }
  }

  return {
    calories: Math.round(calories),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fat: Math.round(fat * 10) / 10,
  };
}

/**
 * Pure calculation helper for scaling a food's nutrients based on amount.
 * Formula: scaled_nutrient = food.nutrient_value * (amount / food.serving_size)
 *
 * @param {Object} food - The base food item from Food Database
 * @param {number} amount - The entered amount/quantity
 * @returns {{ calories: number, protein: number, carbs: number, fat: number, warning: string|null }}
 */
export function scaleFoodNutrients(food, amount) {
  const servingSize = Number(food?.serving_size);
  const numAmount = Number(amount);

  if (!servingSize || servingSize <= 0) {
    return {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      warning: 'Invalid food serving size (must be > 0)',
    };
  }

  if (numAmount <= 0 || isNaN(numAmount)) {
    return {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      warning: 'Amount must be greater than 0',
    };
  }

  const ratio = numAmount / servingSize;

  return {
    calories: Math.round((Number(food.calories) || 0) * ratio),
    protein: Math.round((Number(food.protein) || 0) * ratio * 10) / 10,
    carbs: Math.round((Number(food.carbs) || 0) * ratio * 10) / 10,
    fat: Math.round((Number(food.fat) || 0) * ratio * 10) / 10,
    warning: null,
  };
}

// ─── Nutrition Service ──────────────────────────────────────────────

export const NutritionService = {
  calculatePlanTotals,
  scaleFoodNutrients,

  async list(filters = {}) {
    let query = supabase
      .from('nutrition_plans')
      .select('*, clients(id, full_name, client_code), nutrition_meals(*, nutrition_items(*, foods(*)))')
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
      .from('nutrition_plans')
      .select('*, clients(id, full_name, client_code), nutrition_meals(*, nutrition_items(*, foods(*)))')
      .eq('id', id)
      .single();
    if (error) throw error;
    return formatPlan(data);
  },

  /**
   * Creates a new nutrition plan with its meals and snapshotted nutrition items.
   * Plan-level daily totals are calculated live from meals/items.
   */
  async create(planPayload, meals = []) {
    // 1. Calculate plan totals from items
    const totals = calculatePlanTotals(meals);

    const payload = {
      ...planPayload,
      daily_calories: totals.calories,
      daily_protein: totals.protein,
      daily_carbs: totals.carbs,
      daily_fat: totals.fat,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 2. Insert plan
    const { data: plan, error: planError } = await supabase
      .from('nutrition_plans')
      .insert(payload)
      .select()
      .single();
    if (planError) throw planError;

    // 3. Insert meals and snapshotted items
    await this._insertMealsAndItems(plan.id, meals);

    return this.getById(plan.id);
  },

  /**
   * Updates an existing nutrition plan.
   * If meals are supplied, replaces previous meals/items with the new snapshot.
   */
  async update(id, planPayload, meals = null) {
    let totals = {};
    if (meals && Array.isArray(meals)) {
      totals = calculatePlanTotals(meals);
    }

    const updates = {
      ...planPayload,
      ...(meals ? {
        daily_calories: totals.calories,
        daily_protein: totals.protein,
        daily_carbs: totals.carbs,
        daily_fat: totals.fat,
      } : {}),
      updated_at: new Date().toISOString(),
    };

    // 1. Update plan row
    const { data: plan, error: planError } = await supabase
      .from('nutrition_plans')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (planError) throw planError;

    // 2. If meals provided, replace meals and items (cascade-delete will clear previous items)
    if (meals && Array.isArray(meals)) {
      const { error: delError } = await supabase
        .from('nutrition_meals')
        .delete()
        .eq('nutrition_plan_id', id);
      if (delError) throw delError;

      await this._insertMealsAndItems(id, meals);
    }

    return this.getById(id);
  },

  /**
   * Helper to insert meals and items.
   * Day number defaults to 1 for V1 single-day plans.
   */
  async _insertMealsAndItems(planId, meals) {
    for (let i = 0; i < meals.length; i++) {
      const m = meals[i];
      const items = m.items || m.nutrition_items || [];
      const mealCalories = items.reduce((sum, it) => sum + (Number(it.calories) || 0), 0);

      const { data: meal, error: mealError } = await supabase
        .from('nutrition_meals')
        .insert({
          nutrition_plan_id: planId,
          meal_name: m.meal_name || `Meal ${i + 1}`,
          sort_order: i,
          day_number: m.day_number || 1,
          calories: Math.round(mealCalories),
          notes: m.notes || null,
        })
        .select()
        .single();
      if (mealError) throw mealError;

      if (items.length > 0) {
        const itemRecords = items.map((it) => ({
          meal_id: meal.id,
          food_id: it.food_id || null,
          food_name: it.food_name || 'Food Item',
          amount: Number(it.amount) || Number(it.quantity) || 100,
          unit: it.unit || 'g',
          calories: Number(it.calories) || 0,
          protein: Number(it.protein) || 0,
          carbs: Number(it.carbs) || 0,
          fat: Number(it.fat) || 0,
        }));

        const { error: itemError } = await supabase
          .from('nutrition_items')
          .insert(itemRecords);
        if (itemError) throw itemError;
      }
    }
  },

  /**
   * Save as independent template (is_template = true, client_id = null).
   */
  async saveAsTemplate(planPayload, meals = []) {
    const templatePayload = {
      ...planPayload,
      is_template: true,
      client_id: null,
      name: planPayload.name?.includes('Template') ? planPayload.name : `${planPayload.name} (Template)`,
    };
    return this.create(templatePayload, meals);
  },

  async delete(id) {
    const { error } = await supabase
      .from('nutrition_plans')
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  // ─── Daily Nutrition / Meal Completion ─────────────────────────────

  async logDailyMeals({ clientId, workspaceId, nutritionPlanId, date, mealsCompleted = true, caloriesConsumed = null, notes = null }) {
    const logDate = date || getLocalDateKey(new Date());
    const { data, error } = await supabase
      .from('daily_nutrition_logs')
      .upsert({
        client_id: clientId,
        workspace_id: workspaceId,
        nutrition_plan_id: nutritionPlanId || null,
        log_date: logDate,
        meals_completed: mealsCompleted,
        calories_consumed: caloriesConsumed,
        notes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,log_date' })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getDailyNutritionLog(clientId, date) {
    const logDate = date || getLocalDateKey(new Date());
    const { data, error } = await supabase
      .from('daily_nutrition_logs')
      .select('*')
      .eq('client_id', clientId)
      .eq('log_date', logDate)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  },

  async getWeeklyNutritionLogs(clientId, startDate, endDate) {
    let query = supabase
      .from('daily_nutrition_logs')
      .select('*')
      .eq('client_id', clientId)
      .order('log_date', { ascending: false });

    if (startDate) query = query.gte('log_date', startDate);
    if (endDate) query = query.lte('log_date', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },
};
