import { supabase } from '@/utils/supabase';

export const ClientsService = {
  async list(filters = {}) {
    let query = supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters.workspace_id) {
      query = query.eq('workspace_id', filters.workspace_id);
    }
    if (filters.assigned_ybs_coach_id) {
      query = query.eq('assigned_ybs_coach_id', filters.assigned_ybs_coach_id);
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
      .from('clients')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getByUserId(userId) {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async countActive(workspaceId) {
    let query = supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  },

  async create(payload) {
    // Generate unique code YBS-XXXX if not provided
    let code = payload.client_code;
    if (!code) {
      const rand = Math.floor(1000 + Math.random() * 9000);
      code = `YBS-${rand}`;
    }

    const { data, error } = await supabase
      .from('clients')
      .insert({ ...payload, client_code: code })
      .select()
      .single();

    if (error) {
      if (error.code === 'P0001' || error.message?.includes('WORKSPACE_CAPACITY_REACHED')) {
        const capacityError = Object.assign(
          new Error('This Workspace has reached its active client capacity. Contact a Platform Owner to add another client or request an administrative override.'),
          { code: 'WORKSPACE_CAPACITY_REACHED', originalError: error }
        );
        throw capacityError;
      }
      throw error;
    }
    return data;
  },

  async createWithOverride(payload) {
    const { data, error } = await supabase.rpc('create_client_with_override', {
      p_payload: payload,
    });
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('clients')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'P0001' || error.message?.includes('WORKSPACE_CAPACITY_REACHED')) {
        const capacityError = Object.assign(
          new Error('Cannot reactivate client: Workspace has reached its active client capacity limit.'),
          { code: 'WORKSPACE_CAPACITY_REACHED', originalError: error }
        );
        throw capacityError;
      }
      throw error;
    }
    return data;
  }
};

