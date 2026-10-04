import { isAuthApiError, type Session } from "@supabase/supabase-js";

import { getSupabase } from "~/shared/supabase/client";
import type { AuthState } from "~/features/auth/model/types";

/**
 * 서버가 이 세션을 거절했다는 뜻의 오류 코드.
 *
 * `PGRST301`과 `PGRST302`는 JWT가 없거나 만료·위조된 경우다. `42501`은 권한 거부인데, 앱의
 * 인증 전용 RPC는 `authenticated`에게만 열려 있으므로 여기서 이 코드가 오면 요청이 익명으로
 * 나갔다는 뜻이다.
 *
 * `PGRST303`(JWT issued at future)은 일부러 넣지 않았다. 그건 세션이 아니라 토큰을 발급한
 * 쪽과 검증하는 쪽의 시계가 어긋난 것이라, 다시 로그인해도 새 토큰이 똑같이 거절된다. 여기에
 * 넣으면 게이트와 로그인 화면 사이를 무한히 오간다. 키를 잘못 넣었을 때 오는
 * `Invalid API key`에는 `code` 자체가 없어 자연히 빠진다.
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

/**
 * 저장소에 남은 세션을 지운다.
 *
 * `scope: "local"`이라 네트워크를 타지 않는다. 이미 거절당한 토큰으로 `/logout`을 부르면 그
 * 요청도 실패한다. 지우지 않고 두면 `getSession()`이 계속 같은 세션을 돌려줘서 화면을 옮길
 * 때마다 똑같은 401이 다시 나고, `hasActiveSession()`도 계속 참을 돌려준다.
 */
async function forgetSession(): Promise<void> {
  await getSupabase().auth.signOut({ scope: "local" });
}

/**
 * 인증 전용 호출이 실패했을 때 부른다. 서버가 세션을 거절한 것이면 저장소에 남은 세션을
 * 비우고 그냥 돌아오고, 그 밖의 오류는 그대로 다시 던진다. 돌아왔다면 호출자는 `null`을
 * 반환해 로그인 화면으로 보내면 된다.
 */
export async function clearSessionOrThrow(error: unknown): Promise<void> {
  if (!isRejectedSessionError(error)) throw error;
  await forgetSession();
}

/**
 * 살아 있는 세션을 돌려준다. 세션이 없거나 서버가 갱신을 거절했으면 `null`이다. 호출자는
 * `null`을 "로그인 화면으로 보내라"로만 읽으면 된다.
 *
 * 네트워크 오류는 삼키지 않고 그대로 던진다. 잠깐 끊긴 것과 세션이 죽은 것은 다르고, 전자로
 * 로그아웃시키면 지하철에서 앱을 열었다는 이유로 계정이 풀린다.
 */
export async function readLiveSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();

  if (!error) return data.session;
  if (!isAuthApiError(error)) throw error;

  await forgetSession();
  return null;
}

/**
 * 로그인 상태와 프로필을 함께 읽는다.
 *
 * `null`의 뜻은 "인증되지 않았다" 하나뿐이다. 세션이 없는 경우와 서버가 세션을 거절한 경우를
 * 모두 여기로 접어서, 부르는 route가 에러 화면 대신 `/login`으로 보낼 수 있게 한다.
 */
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
 * 세션이 있는지만 확인한다. 프로필은 읽지 않는다.
 *
 * 게이트(`routes/app/gate.tsx`)와 그 자식 라우트의 clientLoader는 병렬로 돈다. 세션이
 * 없으면 게이트가 `/login`으로 보내지만, 그 사이 자식 로더가 이미 띄운 요청은 취소되지
 * 않는다. 앱의 RPC는 대부분 `authenticated` 전용이라 익명으로 나가면 PostgREST가 401을
 * 돌려주므로(권한 거부라도 JWT가 없으면 403이 아니라 401이다), 인증이 필요한 로더는 요청
 * 전에 이걸로 먼저 걸러야 한다.
 *
 * 왕복이 하나 늘지는 않는다. `getSession()`은 유효한 세션이면 저장소에서 읽고 끝이고,
 * supabase-js가 어차피 모든 요청 앞에서 같은 값을 기다린다. 액세스 토큰이 만료됐다면
 * 여기서 갱신을 마치므로 뒤따르는 요청이 유효한 토큰을 달고 나간다.
 *
 * 실패는 "요청을 보내지 않는다"로만 해석한다. 진짜 에러 화면은 게이트가 책임진다.
 */
export async function hasActiveSession(): Promise<boolean> {
  try {
    return (await readLiveSession()) !== null;
  } catch {
    return false;
  }
}
