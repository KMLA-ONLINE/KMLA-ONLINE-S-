import { mockShellData } from "~/features/app-shell/mock";
import type { ShellData } from "~/features/app-shell/model/types";

/**
 * 셸이 헤더·사이드바·인증 게이트에 쓰는 데이터. Supabase 호출은 이 파일에서만 한다.
 *
 * `null`은 "세션 없음"이다. 어디로 보낼지는 라우트가 정한다 — 게이트 정책을
 * `routes/_app.tsx` 한 곳에 모아 두기 위해 여기서는 리다이렉트를 던지지 않는다.
 *
 * ─── 지금은 mock이다 ───────────────────────────────────────────────────────────
 * `supabase/migrations/`가 비어 있어서 `profiles` 테이블도, 아래 RPC 3개도 아직 없다.
 * 스키마가 들어오면 `~/features/app-shell/mock`을 지우고 본문을 이걸로 바꾼다:
 *
 * ```ts
 * const supabase = getSupabase();
 * const { data: { session } } = await supabase.auth.getSession();
 * if (!session) return null;
 *
 * // 셋을 병렬로 던져서 왕복 한 번에 끝낸다. 뱃지가 느려지면 여기서 제일 먼저 떼어내
 * // 프로미스로 넘기고 `<Await>`로 받는다 — 그 전까진 await가 맞다.
 * const [profileResult, messageResult, notiResult] = await Promise.all([
 *   supabase.rpc("get_my_profile"),
 *   supabase.rpc("get_unread_message_count"),
 *   supabase.rpc("get_unread_notification_count"),
 * ]);
 *
 * if (profileResult.error) throw profileResult.error;
 * const profile = profileResult.data?.[0];
 * // 세션은 있는데 프로필 행이 없다 = 온보딩을 아직 안 끝냈다.
 * if (!profile) return { email: session.user.email ?? "", profile: null, badges: {} };
 *
 * // 뱃지는 실패해도 화면을 막지 않는다. 숫자가 안 보이는 것보다 앱이 안 열리는 게 나쁘다.
 * return {
 *   email: session.user.email ?? "",
 *   profile: { ... },
 *   badges: { "/messenger": messageResult.data ?? 0, "/noti": notiResult.data ?? 0 },
 * };
 * ```
 */
export function loadShellData(): Promise<ShellData | null> {
  return Promise.resolve(mockShellData);
}
