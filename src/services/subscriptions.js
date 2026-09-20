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

  /**
   * Authorized manual activation override (forced activation while the
   * required plans are still pending). Server-side enforced: Platform
   * Owner or the Workspace Owner of the client's workspace. Writes the
   * durable activation_source='manual_override' marker + audit entry and
   * is excluded from activation reconciliation. Trigger-backstop for the
   * plan-delivery rule is still enforced for every other path.
   */
  async activateWithOverride(clientId) {
    const { data, error } = await supabase.rpc('override_activate_client', {
      p_client_id: clientId,
    });
    if (error) throw error;
    return data;
  },

  // ─── Subscription Lifecycle RPCs (System Owner only) ──────────

  /**
   * Freeze a subscription. Pauses the countdown, extends end_date by
   * freeze_days, and records the freeze in subscription_freezes.
   * System Owner ONLY — enforced server-side.
   */
  async freeze(subscriptionId, freezeDays) {
    const { data, error } = await supabase.rpc('freeze_client_subscription', {
      p_subscription_id: subscriptionId,
      p_freeze_days: freezeDays,
    });
    if (error) throw error;
    if (data && data.success === false) {
      throw new Error(data.message || 'Failed to freeze subscription');
    }
    return data;
  },

  /**
   * Cancel an active freeze (backend safety valve). System Owner ONLY.
   */
  async cancelFreeze(freezeId, reason = null) {
    const { data, error } = await supabase.rpc('cancel_client_freeze', {
      p_freeze_id: freezeId,
      p_reason: reason,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Renew a subscription. Creates a new active cycle.
   * Optional p_package_id: if provided, only workspace-owned packages
   *   of the client's workspace are eligible (enforced server-side).
   * System Owner ONLY — enforced server-side.
   */
  async renew(subscriptionId, packageId = null, extendDays = null) {
    const { data, error } = await supabase.rpc('renew_subscription', {
      p_subscription_id: subscriptionId,
      p_package_id: packageId,
      p_extend_days: extendDays,
    });
    if (error) throw error;
    if (data && data.success === false) {
      throw new Error(data.message || 'Failed to renew subscription');
    }
    return data;
  },

  /**
   * Manually override subscription start/end dates. System Owner ONLY.
   * Rules:
   *   - Start cannot be after end.
   *   - Only start -> end recomputed from package duration.
   *   - Only end -> start preserved.
   *   - Both -> both respected.
   *   - Active freeze blocks the override (freeze history untouched).
   */
  async overrideDates(subscriptionId, startDate = null, endDate = null) {
    const { data, error } = await supabase.rpc('override_subscription_dates', {
      p_subscription_id: subscriptionId,
      p_start_date: startDate,
      p_end_date: endDate,
    });
    if (error) throw error;
    if (data && data.success === false) {
      throw new Error(data.message || 'Failed to override subscription dates');
    }
    return data;
  },

  /**
   * Read-only lifecycle summary powered by the single-round-trip
   * client_subscription_summary RPC. Returns freeze-aware days
   * remaining, current package identity, freeze history, and
   * permission-gated financial fields.
   */
  async getSummary(clientId) {
    const { data, error } = await supabase.rpc('client_subscription_summary', {
      p_client_id: clientId,
    });
    if (error) throw error;
    return data;
  },

  /**
   * List workspace-owned packages for the renewal selector.
   * Only packages belonging to the client's own workspace.
   */
  async listWorkspacePackages(workspaceId) {
    const { PackagesService } = await import('@/services/packages');
    const packages = await PackagesService.list(workspaceId);
    // The list() helper already scopes to the workspace or global.
    return packages.filter((p) => p.is_active !== false);
  },
};
