import type { Config } from "@react-router/dev/config";

export default {
  // SPA mode: no runtime server. React Router still renders the root route at
  // build time to emit build/client/index.html, so the root route must stay
  // SSR-safe (no `window` access during the initial render).
  // Data loading lives in `clientLoader` / `clientAction`; authorization is
  // enforced by Supabase RLS, not by a server middleware.
  ssr: false,
} satisfies Config;
