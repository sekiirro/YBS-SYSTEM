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
  },

  // Structured package features (Phase 5). Rows live in package_features
  // with stable ids; packages.features is kept as a projection by the
  // sync_package_features RPC. Reads go through RLS (SELECT only), writes
  // are 100% via the SECURITY DEFINER RPC which enforces owner scope.
  async listFeatures(packageId) {
    const { data, error } = await supabase
      .from('package_features')
      .select('id, title, sort_order, is_active')
      .eq('package_id', packageId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  // items: ordered array of { id?: string, title: string }
  async saveFeatures(packageId, items) {
    const { data, error } = await supabase
      .rpc('sync_package_features', {
        p_package_id: packageId,
        p_items: (items || []).map((f) => ({ id: f.id || null, title: f.title })),
      });
    if (error) throw error;
    return data;
  }
};
