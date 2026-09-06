import { supabase } from '@/utils/supabase';

export const SubscriptionsService = {
  async list(filters = {}) {
    let query = supabase
      .from('subscriptions')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters.client_id) {
      query = query.eq('client_id', filters.client_id);
    }
    if (filters.workspace_id) {
      query = query.eq('workspace_id', filters.workspace_id);
    }
    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('subscriptions')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('subscriptions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Activates a client's package (approval-vs-activation lifecycle).
   * Server-side enforced: Platform Owner or the Workspace Owner of the
   * subscription's workspace. Idempotent.
   */
  async activate(subscriptionId) {
    const { data, error } = await supabase.rpc('activate_client_package', {
      p_subscription_id: subscriptionId,
    });
    if (error) throw error;
    return data;
  },
};
