import { supabase } from '@/utils/supabase';

const REQUEST_SELECT = `
  *,
  clients(id, full_name, client_code),
  nutrition_plans(id, name, is_template, assigned_ybs_coach_id),
  requester:profiles!meal_replacement_requests_requested_by_fkey(id, full_name),
  reviewer:profiles!meal_replacement_requests_reviewer_id_fkey(id, full_name)
`;

/**
 * Client-side meal replacement request workflow.
 *
 * Clients may only READ their own requests and CREATE new pending requests
 * (enforced by RLS: `is_client_self` + `requested_by = auth.uid()`). They have
 * no update/delete path at all. Resolution happens exclusively through the
 * staff-only approve/reject RPCs, which re-apply the candidate produced by the
 * existing Smart Food Replacement engine and — on approval — mutate the plan
 * inside a single database transaction.
 */
export const MealReplacementRequestsService = {
  async listForClient(clientId) {
    const { data, error } = await supabase
      .from('meal_replacement_requests')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /**
   * All requests the current staff user is allowed to see (their workspace or
   * their assigned clients). RLS does the scoping; no workspace filter needed.
   */
  async listForStaff() {
    const { data, error } = await supabase
      .from('meal_replacement_requests')
      .select(REQUEST_SELECT)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      ...r,
      requester_name: r.requester?.full_name || null,
      reviewer_name: r.reviewed_at ? r.reviewer?.full_name || null : null,
    }));
  },

  async listPendingForClient(clientId) {
    const { data, error } = await supabase
      .from('meal_replacement_requests')
      .select('id, meal_id, status')
      .eq('client_id', clientId)
      .eq('status', 'pending');
    if (error) throw error;
    return data || [];
  },

  /**
   * Creates a NEW pending request. Gracefully refuses (without inserting) when
   * the same meal already has a pending request; the partial unique index
   * (meal_id WHERE status = 'pending') is the database backstop.
   */
  async create(payload) {
    const { data: existing, error: dupError } = await supabase
      .from('meal_replacement_requests')
      .select('id')
      .eq('client_id', payload.client_id)
      .eq('meal_id', payload.meal_id)
      .eq('status', 'pending')
      .maybeSingle();
    if (dupError) throw dupError;
    if (existing) {
      throw new Error('You already have a pending replacement request for this meal. Please wait for your coach to review it.');
    }

    const { data, error } = await supabase
      .from('meal_replacement_requests')
      .insert({
        workspace_id: payload.workspace_id,
        client_id: payload.client_id,
        nutrition_plan_id: payload.nutrition_plan_id,
        meal_id: payload.meal_id,
        meal_name: payload.meal_name,
        request_type: payload.request_type, // 'replacement' | 'other'
        status: 'pending',
        requested_by: payload.requested_by,
        current_item_id: payload.current_item_id || null,
        current_food_id: payload.current_food_id || null,
        current_food_name: payload.current_food_name,
        current_macros: payload.current_macros || {},
        requested_food_id: payload.requested_food_id || null,
        requested_food_name: payload.requested_food_name || null,
        requested_replacement: payload.requested_replacement || null,
        reason: payload.reason,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Staff-only: apply the requested replacement through the approve RPC. */
  async approve(id) {
    const { data, error } = await supabase.rpc('approve_meal_replacement_request', {
      p_request_id: id,
    });
    if (error) throw error;
    return data;
  },

  /** Staff-only: reject without touching the plan. */
  async reject(id) {
    const { data, error } = await supabase.rpc('reject_meal_replacement_request', {
      p_request_id: id,
    });
    if (error) throw error;
    return data;
  },
};