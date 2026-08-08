import { ErrorPage } from "~/shared/components/error-page";

/**
 * 스플랫(`*`) 라우트. 셸 **바깥**에 있다 — 없는 주소에 인증 게이트를 통과시킬 이유가 없고,
 * 로그아웃 상태에서 오타 난 링크를 열면 로그인으로 튕기는 대신 404가 보여야 한다.
 */
export default function NotFoundRoute() {
  return <ErrorPage status={404} />;
}
