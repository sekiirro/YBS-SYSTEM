import { supabase } from '@/utils/supabase';

const STAFF_ROLES = ['workspace_owner', 'trainer', 'sales'];

export const TeamService = {
  async list(workspaceId = null) {
    if (workspaceId) {
      // Workspace-scoped staff list: only workspace_owner / trainer / sales
      // memberships belonging to THIS workspace. Client-role memberships are
      // excluded at the query level — the Team view never shows clients.
      const { data: memberships, error: memError } = await supabase
        .from('workspace_memberships')
        .select('workspace_id, workspace_role, status, profiles(*)')
        .eq('workspace_id', workspaceId)
        .in('workspace_role', STAFF_ROLES);

      if (memError) throw memError;
      return (memberships || []).map((m) => ({
        ...(m.profiles || {}),
        workspace_role: m.workspace_role,
        membership_status: m.status,
        workspace_id: m.workspace_id,
      }));
    }

    // Global (Platform Owner) view: every staff member across the platform.
    // Platform-level staff (platform_owner / platform_trainer) are included,
    // and workspace staff (workspace_owner / trainer / sales) are included via
    // their memberships. Users whose only membership role is 'client' never
    // appear, because client memberships are never selected here.
    const byId = new Map();

    const { data: platformStaff, error: psError } = await supabase
      .from('profiles')
      .select('*')
      .in('platform_role', ['platform_owner', 'platform_trainer']);
    if (psError) throw psError;
    for (const p of platformStaff || []) {
      byId.set(p.id, { ...p, workspace_role: p.platform_role });
    }

    const { data: memberships, error: memError } = await supabase
      .from('workspace_memberships')
      .select('workspace_id, workspace_role, status, profiles(*)')
      .in('workspace_role', STAFF_ROLES);
    if (memError) throw memError;
    for (const m of memberships || []) {
      const p = m.profiles;
      if (!p) continue;
      if (!byId.has(p.id)) {
        byId.set(p.id, {
          ...p,
          workspace_role: m.workspace_role,
          membership_status: m.status,
          workspace_id: m.workspace_id,
        });
      }
    }

    return Array.from(byId.values());
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
