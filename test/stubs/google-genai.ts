/**
 * Test stub for `npm:@google/genai@2.22.0`.
 *
 * Node cannot resolve Deno's `npm:` specifier, and the real SDK would make a
 * network call. Tests install a handler on `globalThis.__geminiGenerateContent`
 * to script the Gemini route; without one, the route throws so a test that
 * unexpectedly reaches Gemini fails loudly instead of silently passing.
 */
export class GoogleGenAI {
  constructor(public readonly options: { apiKey: string }) {}

  models = {
    generateContent: async (request: unknown) => {
      const handler = (globalThis as any).__geminiGenerateContent;
      if (typeof handler !== 'function') {
        throw new Error('gemini stub: no __geminiGenerateContent handler installed');
      }
      return handler(request);
    },
  };
}

export default { GoogleGenAI };
