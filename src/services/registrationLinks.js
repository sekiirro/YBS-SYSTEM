import { supabase } from '@/utils/supabase';

const REGISTRATION_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-registration`;

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

  /**
   * Register a new client through the Edge Function, which enforces
   * server-side IP protection (same link + same IP → rejected).
   * The browser must NOT call supabase.auth.signUp() directly for
   * link-scoped registrations — the Edge Function proxies account
   * creation and preserves handle_new_user() behavior.
   */
  async registerClient(payload) {
    const { token, email, phone, password } = payload;
    const fullName = (
      payload.full_name ||
      [payload.first_name, payload.last_name].filter(Boolean).join(' ')
    ).trim();
    const body = {
      token,
      full_name: fullName,
      email: email?.toLowerCase().trim(),
      phone,
      password,
    };
    const resp = await fetch(REGISTRATION_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!resp.ok) {
      const err = new Error(data?.error?.message || 'Registration failed');
      err.code = data?.error?.code || 'registration_failed';
      err.status = resp.status;
      throw err;
    }
    return data;
  },
};