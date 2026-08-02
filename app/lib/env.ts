/**
 * Typed access to the browser-visible environment.
 *
 * In SPA mode there is no server, so every value here ends up inside the
 * client bundle. Only ever put publishable/anon-grade values in `VITE_*`.
 *
 * Values are read lazily: a missing variable must fail where it is used, not
 * where this module is imported, so that route modules stay importable in unit
 * tests and during the build-time render of the root route.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl(): string {
    return required("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL);
  },
  get supabasePublishableKey(): string {
    return required(
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    );
  },
};
