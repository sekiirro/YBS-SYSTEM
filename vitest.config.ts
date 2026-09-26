import { defineConfig } from 'vitest/config';
import path from 'path';

// Edge-function tests run under Vitest instead of Deno. Two shims are needed:
//  - `Deno.env` for provider secret resolution (aiProviders.ts).
//  - the Deno-specifier `npm:@google/genai@2.22.0`, which Node cannot resolve.
// A third covers `https://esm.sh/@supabase/supabase-js@2`, which Node's ESM
// loader rejects because it has no loader for `https:` specifiers. The
// create-plan entrypoint imports it for the `UserClient` type only, so the
// prompt-builder tests never touch a connection.
export default defineConfig({
  resolve: {
    alias: {
      'npm:@google/genai@2.22.0': path.resolve(__dirname, './test/stubs/google-genai.ts'),
      'https://esm.sh/@supabase/supabase-js@2': path.resolve(__dirname, './test/stubs/supabase-js.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['supabase/functions/**/__tests__/**/*.test.ts'],
    // Entry points call `Deno.serve` at module scope, so importing one needs a
    // Deno global to exist. Runs before the test module is imported.
    setupFiles: [path.resolve(__dirname, './test/stubs/deno-setup.ts')],
    // The router genuinely sleeps ~2s between same-route retries, and a full
    // six-route exhaustion walks several of those. Real timers, real budget.
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
