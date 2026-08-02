import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "~/lib/env";
import type { Database } from "./database.types";

export type TypedSupabaseClient = SupabaseClient<Database>;

let client: TypedSupabaseClient | undefined;

/**
 * The single browser Supabase client.
 *
 * SPA mode has no server, so the session lives in `localStorage` and every
 * read/write is authorized by RLS on the database. This is created lazily so
 * that importing a module does not touch `localStorage` during the build-time
 * render of the root route.
 */
export function getSupabase(): TypedSupabaseClient {
  if (typeof window === "undefined") {
    throw new Error(
      "getSupabase() is browser-only. Call it from a clientLoader, an event " +
        "handler, or an effect — never during the initial render of the root route.",
    );
  }

  client ??= createClient<Database>(
    env.supabaseUrl,
    env.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    },
  );

  return client;
}

/** Test-only: drop the memoized client so each test gets a clean instance. */
export function resetSupabaseForTests(): void {
  client = undefined;
}
