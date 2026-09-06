import { supabase } from '@/utils/supabase';
import { uploadFile, getProgressPhotoUrl } from './storage';

export const MetricsService = {
  async listByClient(clientId) {
    const { data, error } = await supabase
      .from('metrics')
      .select('*, progress_photos(*)')
      .eq('client_id', clientId)
      .order('entry_date', { ascending: false });
    if (error) throw error;

    // Securely resolve signed URLs for private photos
    const list = data || [];
    for (const entry of list) {
      if (Array.isArray(entry.progress_photos)) {
        for (const photo of entry.progress_photos) {
          photo.signed_url = await getProgressPhotoUrl(photo.photo_url);
        }
      }
    }
    return list;
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('metrics')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('metrics')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('metrics')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  async uploadPhoto({ clientId, metricId, workspaceId, file, angle = 'front' }) {
    const fileExt = file.name ? file.name.split('.').pop() : 'jpg';
    const filePath = `clients/${clientId}/${Date.now()}_${angle}.${fileExt}`;
    
    // Upload to private progress-photos bucket
    const { path } = await uploadFile({
      file,
      bucket: 'progress-photos',
      path: filePath,
    });

    // Record photo in database
    const { data, error } = await supabase
      .from('progress_photos')
      .insert({
        client_id: clientId,
        metric_id: metricId || null,
        workspace_id: workspaceId,
        photo_url: path,
        angle,
        captured_at: new Date().toISOString().split('T')[0],
      })
      .select()
      .single();

    if (error) throw error;
    data.signed_url = await getProgressPhotoUrl(path);
    return data;
  }
};
