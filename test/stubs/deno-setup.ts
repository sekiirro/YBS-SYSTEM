/**
 * Minimal Deno global for Vitest.
 *
 * Edge-function entrypoints call `Deno.serve(handler)` at module scope, so
 * merely importing one throws `ReferenceError: Deno is not defined` under Node.
 * This installs just enough of the Deno surface for a module to be *loaded*:
 * an `env.get` that reports no secrets, and a no-op `serve` so importing a
 * function does not start a listener.
 *
 * Tests that need real secret resolution overwrite `globalThis.Deno`
 * themselves before exercising the code, exactly as they did before this shim
 * existed.
 */
const envGet = () => undefined;

(globalThis as any).Deno ??= {
  env: { get: envGet },
  serve: () => undefined,
};
