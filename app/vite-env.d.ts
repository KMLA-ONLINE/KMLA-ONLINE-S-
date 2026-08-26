/// <reference types="vite/client" />

/**
 * Narrows Vite's `ImportMetaEnv`, whose default index signature types every
 * lookup as `any`. Declared as possibly-undefined on purpose: a `.env` file can
 * always be missing a key at runtime, and `app/lib/env.ts` is what turns that
 * into a readable error.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string | undefined;
  readonly VITE_WEB_PUSH_VAPID_PUBLIC_KEY: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
