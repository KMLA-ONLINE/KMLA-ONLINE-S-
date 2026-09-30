import { isAuthApiError, type Session } from "@supabase/supabase-js";

import { getSupabase } from "~/shared/supabase/client";
import type { AuthState } from "~/features/auth/model/types";

/**
 * 서버가 세션을 거절했다는 오류 코드. `42501`은 인증 전용 RPC에 요청이 익명으로 나갔다는 뜻이다.
 * `PGRST303`(시계 불일치)은 재로그인해도 같은 토큰이 거절돼 게이트와 로그인 화면을 무한히 오가므로 뺐다.
 */
const REJECTED_SESSION_CODES = new Set(["PGRST301", "PGRST302", "42501"]);

function isRejectedSessionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    REJECTED_SESSION_CODES.has(String(error.code))
  );
}

/** 저장소의 세션을 지운다. `scope: "local"`이라 네트워크를 타지 않는다(거절된 토큰으로는 `/logout`도 실패한다). */
async function forgetSession(): Promise<void> {
  await getSupabase().auth.signOut({ scope: "local" });
}

/**
 * 서버가 세션을 거절한 오류면 저장소 세션을 비우고 돌아온다(호출자는 `null`로 로그인 화면행).
 * 그 밖의 오류는 다시 던진다.
 */
export async function clearSessionOrThrow(error: unknown): Promise<void> {
  if (!isRejectedSessionError(error)) throw error;
  await forgetSession();
}

/**
 * 살아 있는 세션. 없거나 갱신이 거절되면 `null`.
 * 네트워크 오류는 던진다 — 잠깐 끊긴 것을 세션 사망으로 읽어 로그아웃시키지 않으려는 것이다.
 */
export async function readLiveSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();

  if (!error) return data.session;
  if (!isAuthApiError(error)) throw error;

  await forgetSession();
  return null;
}

/** 로그인 상태와 프로필을 읽는다. `null`은 "인증되지 않음" 하나뿐이라 route가 `/login`으로 보낸다. */
export async function loadAuthState(): Promise<AuthState | null> {
  const session = await readLiveSession();
  if (!session) return null;

  const { data: profiles, error: profileError } =
    await getSupabase().rpc("get_my_profile");

  if (profileError) {
    await clearSessionOrThrow(profileError);
    return null;
  }

  return {
    email: session.user.email ?? "",
    profile: profiles[0] ?? null,
  };
}

/**
 * 세션 유무만 확인한다. 게이트와 자식 clientLoader는 병렬로 돌아, 인증이 필요한 로더는
 * 익명 요청(401)이 나가기 전에 이걸로 먼저 걸러야 한다. `getSession()`은 저장소에서 읽으므로 왕복이 늘지 않는다.
 * 실패는 "요청을 보내지 않는다"로만 해석하고, 에러 화면은 게이트가 맡는다.
 */
export async function hasActiveSession(): Promise<boolean> {
  try {
    return (await readLiveSession()) !== null;
  } catch {
    return false;
  }
}
