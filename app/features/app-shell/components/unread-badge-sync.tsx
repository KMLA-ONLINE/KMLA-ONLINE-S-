import { useEffect, useEffectEvent } from "react";

import { useUnreadCounts } from "~/features/app-shell/context/app-shell-context";
import { setAppBadgeCount } from "~/shared/lib/app-badge";
import { setTabBadgeCount } from "~/shared/lib/tab-badge";

/** 서비스 워커(`public/push-sw.js`)가 홈 화면 숫자를 카드 수로 덮은 뒤 보내는 알림. */
const APP_BADGE_OVERWRITTEN = "app-badge-overwritten";

function isAppBadgeOverwritten(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === APP_BADGE_OVERWRITTEN
  );
}

/**
 * 셸 밖의 안 읽음 표시(홈 화면 아이콘 숫자, 브라우저 탭 제목·아이콘)를 사이드바 뱃지와 같은 값으로 맞춘다.
 * 알림과 메시지를 합친 수다. 서비스 워커의 홈 화면 숫자는 화면에 남은 알림 카드만 센 근사치라, 앱이
 * 떠 있는 동안 서비스 워커가 숫자를 덮으면 여기가 다시 덮는다.
 */
export function UnreadBadgeSync() {
  const { notifications, messages, pending } = useUnreadCounts();
  const total = notifications + messages;

  useEffect(() => {
    // 아직 못 읽었으면 0으로 지우지 않는다. 로딩 중에 뱃지가 사라졌다 돌아오면 그게 더
    // 눈에 띈다.
    if (pending) return;
    setAppBadgeCount(total);
    setTabBadgeCount(total);
  }, [pending, total]);

  const restoreAppBadge = useEffectEvent(() => {
    if (!pending) setAppBadgeCount(total);
  });

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      if (isAppBadgeOverwritten(event.data)) restoreAppBadge();
    };
    container.addEventListener("message", onMessage);
    return () => container.removeEventListener("message", onMessage);
  }, []);

  // 셸을 떠나면(로그아웃 등) 탭 표시를 걷는다. 홈 화면 숫자는 OS가 들고 있어 계정이 바뀔 때
  // `user-scoped-storage`가 지운다.
  useEffect(() => () => setTabBadgeCount(0), []);

  return null;
}
