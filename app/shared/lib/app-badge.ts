/**
 * 홈 화면 아이콘 위의 안 읽은 수(Badging API).
 *
 * 설치형 PWA에서 앱을 열지 않고도 새 공지가 있다는 걸 알 수 있는 유일한 표시다.
 * iOS 16.4+ 설치형 PWA, Android, 데스크톱이 지원하고 나머지는 조용히 무시된다.
 *
 * 값의 주인은 서버가 세는 안 읽은 수(`notificationBadgeQuery()`)다. 앱이 떠 있는 동안은
 * 여기로만 쓰고, 앱이 없는 동안 도착한 push는 서비스 워커(`public/push-sw.js`)가 화면에
 * 남은 카드 수로 임시로 채운다. 앱이 다시 뜨면 게이트 로더가 서버 값을 읽어 덮으므로
 * 둘이 어긋나도 다음 실행에서 맞춰진다.
 */

type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * `count`가 0이면 뱃지를 지운다. `setAppBadge(0)`도 지우기로 규정돼 있지만 구현이 갈려
 * 점 하나가 남는 브라우저가 있어 명시적으로 나눈다.
 *
 * 실패는 삼킨다. 미지원 환경과 권한이 없는 경우가 정상 경로에 있고, 뱃지 하나 때문에
 * 이걸 부르는 effect가 깨질 이유가 없다.
 */
export function setAppBadgeCount(count: number): void {
  if (typeof navigator === "undefined") return;

  const badging = navigator as BadgingNavigator;
  const apply =
    count > 0
      ? badging.setAppBadge?.bind(badging, count)
      : badging.clearAppBadge?.bind(badging);

  void apply?.().catch(() => undefined);
}
