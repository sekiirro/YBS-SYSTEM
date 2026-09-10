import { supabase } from '@/utils/supabase';

// ─── Form Assignment Rules (Phase 4 automation) ──────────────
// Rules are managed exclusively through SECURITY DEFINER RPCs that
// re-check Platform Owner / Workspace Owner roles server-side.
// Selection is read-only and governed by the table RLS policies.

export const FormRulesService = {
  /**
   * Load every rule the current user is allowed to see (RLS-scoped).
   */
  async listRules() {
    const { data, error } = await supabase
      .from('form_assignment_rules')
      .select('*, assessment_templates(name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      ...r,
      template_name: r.assessment_templates?.name || null,
    }));
  },

  /**
   * Load automatic assignment instances (only what the caller may see).
   */
  async listInstances(filters = {}) {
    let query = supabase
      .from('form_assignment_instances')
      .select('*, clients(full_name, client_code), assessments(name)')
      .order('assigned_at', { ascending: false });

    if (filters.client_id) query = query.eq('client_id', filters.client_id);
    if (filters.rule_id) query = query.eq('rule_id', filters.rule_id);
    if (filters.trigger_type) query = query.eq('trigger_type', filters.trigger_type);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((i) => ({
      ...i,
      client_name: i.clients?.full_name || null,
      client_code: i.clients?.client_code || null,
      form_name: i.assessments?.name || null,
    }));
  },

  /**
   * Create a form assignment rule. Platform Owners may leave workspace_id
   * null ("All Workspaces"); Workspace Owners' audience resolves server-side.
   */
  async create({ name, form_template_id, trigger_type, workspace_id = null, recurrence_days = null, is_enabled = true }) {
    const { data, error } = await supabase.rpc('create_form_assignment_rule', {
      p_name: name,
      p_form_template_id: form_template_id,
      p_trigger_type: trigger_type,
      p_workspace_id: workspace_id,
      p_recurrence_days: recurrence_days,
      p_is_enabled: is_enabled,
    });
    if (error) throw error;
    return data;
  },

  /** Update an existing rule (full-payload write; ownership re-checked). */
  async update(ruleId, { name, form_template_id, trigger_type, workspace_id = null, recurrence_days = null, is_enabled = true }) {
    const { data, error } = await supabase.rpc('update_form_assignment_rule', {
      p_rule_id: ruleId,
      p_name: name,
      p_form_template_id: form_template_id,
      p_trigger_type: trigger_type,
      p_workspace_id: workspace_id,
      p_recurrence_days: recurrence_days,
      p_is_enabled: is_enabled,
    });
    if (error) throw error;
    return data;
  },

  /** Quickly pause/resume a rule. */
  async setEnabled(ruleId, isEnabled) {
    const { data, error } = await supabase.rpc('set_form_assignment_rule_enabled', {
      p_rule_id: ruleId,
      p_is_enabled: isEnabled,
    });
    if (error) throw error;
    return data;
  },

  /** Delete a rule (assignment history is kept via ON DELETE SET NULL). */
  async remove(ruleId) {
    const { data, error } = await supabase.rpc('delete_form_assignment_rule', {
      p_rule_id: ruleId,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Trigger-5 event: renew a client's subscription. Current cycle is closed
   * (status 'renewed') and a new active cycle opens on the same package.
   * Automatically evaluates subscription_renewal form rules for the new cycle.
   */
  async renewSubscription(subscriptionId, extendDays = null) {
    const { data, error } = await supabase.rpc('renew_subscription', {
      p_subscription_id: subscriptionId,
      p_extend_days: extendDays,
    });
    if (error) throw error;
    return data;
  },
};