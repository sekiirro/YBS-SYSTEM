import { supabase } from '@/utils/supabase';

export const RegistrationLinksService = {
  async listForWorkspace(workspaceId) {
    const { data, error } = await supabase.rpc('get_workspace_registration_links', {
      p_workspace_id: workspaceId,
    });
    if (error) throw error;
    return data || [];
  },

  async assignCoach(workspaceId, coachId) {
    const { data, error } = await supabase.rpc('assign_workspace_coach', {
      p_workspace_id: workspaceId,
      p_coach_id: coachId || null,
    });
    if (error) throw error;
    return data;
  },

  buildUrl(token) {
    return `${window.location.origin}/join/${token}`;
  },
};