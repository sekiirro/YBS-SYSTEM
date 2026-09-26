/**
 * Stub for the Deno-native `https://esm.sh/@supabase/supabase-js@2` specifier.
 *
 * `create-plan/index.ts` imports `createClient` only to derive the `UserClient`
 * type (`ReturnType<typeof createClient>`); the tests that exercise the prompt
 * builders never open a connection. Node's ESM loader refuses `https:`
 * specifiers outright, so the real module cannot be imported under Vitest.
 * Keeping the shim shape-compatible means the type still resolves and any
 * future runtime use fails loudly here instead of silently reaching the network.
 */
export function createClient(_url: string, _key: string, _options?: unknown): any {
  throw new Error(
    'supabase-js stub: Create Plan prompt tests must not open a database connection.',
  );
}
