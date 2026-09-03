import { supabase } from '@/utils/supabase';

/**
 * Upload a file to Supabase Storage.
 * @param {Object} params
 * @param {File|Blob} params.file
 * @param {string} [params.bucket='assets'] - Storage bucket name ('progress-photos', 'avatars', 'assets')
 * @param {string} params.path - Destination path inside bucket
 * @param {boolean} [params.upsert=true]
 * @returns {Promise<{ path: string, url: string }>}
 */
export async function uploadFile({ file, bucket = 'assets', path, upsert = true }) {
  if (!file) throw new Error('No file provided for upload');
  
  const cleanPath = path.replace(/^\/+/, '');
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(cleanPath, file, { upsert });

  if (error) throw error;

  // For private buckets (like progress-photos), generate a signed URL
  if (bucket === 'progress-photos') {
    const signed = await getSignedUrl(bucket, data.path, 86400); // 24h
    return { path: data.path, url: signed };
  }

  // For public buckets, return public URL
  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return { path: data.path, url: publicData.publicUrl };
}

/**
 * Generate a temporary signed URL for private bucket objects.
 * @param {string} bucket
 * @param {string} path
 * @param {number} [expiresIn=3600]
 * @returns {Promise<string>}
 */
export async function getSignedUrl(bucket, path, expiresIn = 3600) {
  if (!path) return '';
  const cleanPath = path.replace(/^\/+/, '');
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(cleanPath, expiresIn);

  if (error) {
    console.warn('Error creating signed URL:', error.message);
    return '';
  }
  return data.signedUrl;
}

/**
 * Securely resolve a progress photo URL.
 * If photo_url is a storage path, generate a signed URL; if already http(s), return as is.
 * @param {string} photoPathOrUrl
 * @returns {Promise<string>}
 */
export async function getProgressPhotoUrl(photoPathOrUrl) {
  if (!photoPathOrUrl) return '';
  if (photoPathOrUrl.startsWith('http://') || photoPathOrUrl.startsWith('https://')) {
    return photoPathOrUrl;
  }
  return await getSignedUrl('progress-photos', photoPathOrUrl, 7200);
}
