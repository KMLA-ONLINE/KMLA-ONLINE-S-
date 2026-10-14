import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "~/shared/lib/env";
import type { Database } from "./database.types";

export type TypedSupabaseClient = SupabaseClient<Database>;

let client: TypedSupabaseClient | undefined;

/**
 * 세션을 담는 `localStorage` key. supabase-js의 기본값과 같은 값을 직접 넘긴다. 바꾸면 저장된 세션을
 * 못 찾아 모두 로그아웃되고, 기본값에 맡기면 `hasStoredSession()`이 라이브러리 내부 형식을 따라가야 한다.
 */
function sessionStorageKey(): string {
  return `sb-${new URL(env.supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/**
 * 이 브라우저에 저장된 로그인 세션이 있는가. client를 만들지 않고 동기로 본다. 만료 여부는 보지 않는다.
 */
export function hasStoredSession(): boolean {
  try {
    return window.localStorage.getItem(sessionStorageKey()) !== null;
  } catch {
    return false;
  }
}

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
        storageKey: sessionStorageKey(),
      },
    },
  );

  return client;
}
