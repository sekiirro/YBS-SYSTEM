import { supabase } from '@/utils/supabase';

export class GeminiError extends Error {
  constructor(message, code = 'gemini_error') {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
  }
}

export async function askGemini({ prompt } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new GeminiError('A prompt is required.', 'invalid_prompt');
  }

  const { data, error } = await supabase.functions.invoke('gemini', {
    body: { prompt },
  });

  if (error) {
    const body = error?.context;
    throw new GeminiError(
      body?.error || 'AI service is currently unavailable.',
      body?.code || 'ai_unavailable',
    );
  }

  if (!data || data.success !== true) {
    throw new GeminiError(
      data?.error || 'AI service is currently unavailable.',
      data?.code || 'ai_unavailable',
    );
  }

  return data.text;
}