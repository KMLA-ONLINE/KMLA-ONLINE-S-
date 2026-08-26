import { getSupabase } from "~/shared/supabase/client";
import type { AuthState } from "~/features/auth/model/types";

export async function loadAuthState(): Promise<AuthState | null> {
  const supabase = getSupabase();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;
  if (!session) return null;

  const { data: profiles, error: profileError } =
    await supabase.rpc("get_my_profile");
  if (profileError) throw profileError;

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
  const {
    data: { session },
    error,
  } = await getSupabase().auth.getSession();

  return !error && session !== null;
}
