import { redirect } from "react-router";

import { signOut } from "~/features/auth";

/**
 * 화면이 없는 라우트. `clientLoader`만 있고 컴포넌트가 없어도 되는 이유는 로더가 항상
 * 리다이렉트를 던지기 때문이다.
 *
 * 세션은 `localStorage`에 있으므로 로그아웃은 순수 클라이언트 작업이다 — SPA라 서버 세션이 없다.
 */
export async function clientLoader() {
  await signOut();
  throw redirect("/login");
}

export default function LogoutRoute() {
  return null;
}
