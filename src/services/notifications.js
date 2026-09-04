import { supabase } from '@/utils/supabase';

export const NotificationsService = {
  async list(userId) {
    if (!userId) return [];
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async markAsRead(id) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async markAllAsRead(userId) {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) throw error;
    return true;
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        ...payload,
        delivery_status: 'delivered',
        delivery_channel: 'in_app',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
};
