import { supabase } from '@/utils/supabase';

export const AssessmentsService = {
  async list(filters = {}) {
    let query = supabase
      .from('assessments')
      .select('*, assessment_responses(*)')
      .order('created_at', { ascending: false });

    if (filters.client_id) {
      query = query.eq('client_id', filters.client_id);
    }
    if (filters.workspace_id) {
      query = query.eq('workspace_id', filters.workspace_id);
    }
    if (filters.assigned_ybs_coach_id) {
      query = query.eq('assigned_ybs_coach_id', filters.assigned_ybs_coach_id);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
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

  async submitResponses(assessmentId, responses) {
    // Upsert responses into assessment_responses
    const records = responses.map((r) => ({
      assessment_id: assessmentId,
      question_id: r.question_id || null,
      question_label: r.question_label || '',
      response_value: r.response_value || {},
    }));

    const { error: respErr } = await supabase
      .from('assessment_responses')
      .insert(records);
    if (respErr) throw respErr;

    return this.update(assessmentId, {
      submission_status: 'submitted',
      submitted_at: new Date().toISOString(),
    });
  }
};
