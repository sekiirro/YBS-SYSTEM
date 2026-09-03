import { supabase } from '@/utils/supabase';

export const TeamService = {
  async list(workspaceId = null) {
    let query = supabase
      .from('profiles')
      .select('*, workspace_memberships(*)')
      .order('created_at', { ascending: false });

    if (workspaceId) {
      // Return members of this workspace
      const { data: memberships, error: memError } = await supabase
        .from('workspace_memberships')
        .select('user_id, workspace_role, status, profiles(*)')
        .eq('workspace_id', workspaceId);

      if (memError) throw memError;
      return (memberships || []).map((m) => ({
        ...(m.profiles || {}),
        workspace_role: m.workspace_role,
        membership_status: m.status,
      }));
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async updateMember(userId, updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
};
