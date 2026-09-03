import { supabase } from '@/utils/supabase';

export const AuditService = {
  async list(filters = {}) {
    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters.workspace_id) {
      query = query.eq('workspace_id', filters.workspace_id);
    }
    if (filters.actor_id) {
      query = query.eq('actor_id', filters.actor_id);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async log(payload) {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .insert(payload)
        .select()
        .single();
      if (error) {
        console.warn('Audit logging warning:', error.message);
      }
      return data;
    } catch (err) {
      console.warn('Audit logging failed silently:', err);
      return null;
    }
  }
};
