import { supabase } from '@/utils/supabase';
import { NotificationsService } from '@/services/notifications';

// ─── Templates ───────────────────────────────────────────────

export const TemplatesService = {
  async list(filters = {}) {
    let query = supabase
      .from('assessment_templates')
      .select('*, assessment_questions(count), form_template_workspace_assignment(workspace_id)')
      .order('created_at', { ascending: false });

    if (filters.workspace_id) query = query.eq('workspace_id', filters.workspace_id);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.created_by) query = query.eq('created_by', filters.created_by);
    if (filters.is_active !== undefined) query = query.eq('is_active', filters.is_active);

    let { data, error } = await query;
    if (error) {
      // Fallback in case of relationship name variation
      const fallback = await supabase
        .from('assessment_templates')
        .select('*, assessment_questions(count)')
        .order('created_at', { ascending: false });
      if (fallback.error) throw error;
      data = fallback.data;
    }
    return (data || []).map((t) => ({
      ...t,
      question_count: t.assessment_questions?.[0]?.count || 0,
      assigned_workspace_ids: (t.form_template_workspace_assignment || t.form_template_workspace_assignments || []).map((a) => a.workspace_id),
    }));
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('assessment_templates')
      .select('*, assessment_questions(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    // Sort questions by sort_order
    if (data.assessment_questions) {
      data.assessment_questions.sort((a, b) => a.sort_order - b.sort_order);
    }
    return data;
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('assessment_templates')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('assessment_templates')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('assessment_templates')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  /**
   * Platform-owner only: assign a GLOBAL master template to a workspace.
   * Enforced server-side by the guarded assign_form_template RPC.
   */
  async assignToWorkspace(templateId, workspaceId) {
    const { data, error } = await supabase.rpc('assign_form_template', {
      p_template_id: templateId,
      p_workspace_id: workspaceId,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Platform-owner only: revoke a workspace's access to a master template.
   */
  async unassignFromWorkspace(templateId, workspaceId) {
    const { data, error } = await supabase.rpc('unassign_form_template', {
      p_template_id: templateId,
      p_workspace_id: workspaceId,
    });
    if (error) throw error;
    return data;
  },
};

// ─── Questions ───────────────────────────────────────────────

export const QuestionsService = {
  async list(templateId) {
    const { data, error } = await supabase
      .from('assessment_questions')
      .select('*')
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('assessment_questions')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('assessment_questions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('assessment_questions')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async reorder(templateId, orderedIds) {
    // Update sort_order for each question
    const updates = orderedIds.map((qId, idx) =>
      supabase
        .from('assessment_questions')
        .update({ sort_order: idx })
        .eq('id', qId)
        .eq('template_id', templateId)
    );
    await Promise.all(updates);
  },

  async bulkUpsert(templateId, questions) {
    // Delete existing questions for this template and re-insert
    // This is used when saving the full form builder state
    const { error: delErr } = await supabase
      .from('assessment_questions')
      .delete()
      .eq('template_id', templateId);
    if (delErr) throw delErr;

    if (questions.length === 0) return [];

    const records = questions.map((q, idx) => ({
      template_id: templateId,
      sort_order: idx,
      question_type: q.question_type,
      label: q.label,
      description: q.description || null,
      required: q.required || false,
      options: q.options || [],
      conditional_rules: q.conditional_rules || null,
    }));

    const { data, error } = await supabase
      .from('assessment_questions')
      .insert(records)
      .select();
    if (error) throw error;
    return data || [];
  },
};

// ─── Assessments (Assigned Forms) ────────────────────────────

export const AssessmentsService = {
  async list(filters = {}) {
    let query = supabase
      .from('assessments')
      .select('*, assessment_responses(count)')
      .order('created_at', { ascending: false });

    if (filters.client_id) query = query.eq('client_id', filters.client_id);
    if (filters.workspace_id) query = query.eq('workspace_id', filters.workspace_id);
    if (filters.assigned_ybs_coach_id) query = query.eq('assigned_ybs_coach_id', filters.assigned_ybs_coach_id);
    if (filters.submission_status) query = query.eq('submission_status', filters.submission_status);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((a) => ({
      ...a,
      response_count: a.assessment_responses?.[0]?.count || 0,
    }));
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('assessments')
      .select('*, assessment_responses(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('assessments')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('assessments')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Assign a form to a client by snapshotting template questions.
   */
  async assignToClient({ templateId, clientId, workspaceId, coachId, name, dueDate }) {
    // 1. Fetch template questions
    const questions = await QuestionsService.list(templateId);

    // 2. Create the snapshot
    const snapshot = questions.map((q) => ({
      id: q.id,
      sort_order: q.sort_order,
      question_type: q.question_type,
      label: q.label,
      description: q.description,
      required: q.required,
      options: q.options,
      conditional_rules: q.conditional_rules,
    }));

    // 3. Create the assessment
    const assessment = await this.create({
      workspace_id: workspaceId,
      client_id: clientId,
      template_id: templateId,
      name,
      assigned_ybs_coach_id: coachId,
      due_date: dueDate || null,
      submission_status: 'pending',
      questions_snapshot: snapshot,
    });

    return assessment;
  },

  /**
   * Save responses without submitting (upsert to prevent duplicates).
   */
  async saveResponses(assessmentId, responses) {
    if (!responses || responses.length === 0) return;

    const records = responses.map((r) => ({
      assessment_id: assessmentId,
      question_id: r.question_id || null,
      question_label: r.question_label || '',
      response_value: r.response_value != null ? r.response_value : {},
    }));

    const { error } = await supabase
      .from('assessment_responses')
      .upsert(records, { onConflict: 'assessment_id,question_id' });
    if (error) throw error;
  },

  /**
   * Submit form: validate → save responses → mark submitted → notify.
   * Notification failure does NOT roll back submission.
   */
  async submitForm(assessmentId, responses, { clientUserId, coachUserId, workspaceId, formName }) {
    // 1. Check not already submitted
    const existing = await this.getById(assessmentId);
    if (existing.submission_status === 'submitted' || existing.submission_status === 'reviewed') {
      throw new Error('This form has already been submitted.');
    }

    // 2. Save responses (upsert)
    await this.saveResponses(assessmentId, responses);

    // 3. Mark as submitted
    const submitted = await this.update(assessmentId, {
      submission_status: 'submitted',
      submitted_at: new Date().toISOString(),
    });

    // 4. Notifications (fire-and-forget — don't throw on failure)
    try {
      // Notify trainer
      if (coachUserId) {
        await NotificationsService.create({
          workspace_id: workspaceId,
          user_id: coachUserId,
          type: 'form_submitted',
          title: 'Form Submitted',
          message: `Your client has completed the form "${formName}" and is waiting for their plan.`,
          related_entity_type: 'assessment',
          related_entity_id: assessmentId,
        });
      }

      // Notify client
      if (clientUserId) {
        await NotificationsService.create({
          workspace_id: workspaceId,
          user_id: clientUserId,
          type: 'form_confirmation',
          title: 'Form Submitted Successfully',
          message: `Your "${formName}" has been submitted. Your training and nutrition plan will be ready within 3–7 days.`,
          related_entity_type: 'assessment',
          related_entity_id: assessmentId,
        });
      }
    } catch (notifErr) {
      console.warn('Notification send failed (submission still saved):', notifErr);
    }

    return submitted;
  },
};
