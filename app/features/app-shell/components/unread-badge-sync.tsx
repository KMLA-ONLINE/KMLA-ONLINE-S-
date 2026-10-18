import { useEffect } from "react";

import { useUnreadCounts } from "~/features/app-shell/context/app-shell-context";
import { setAppBadgeCount } from "~/shared/lib/app-badge";
import { setTabBadgeCount } from "~/shared/lib/tab-badge";

/**
 * 셸 밖의 안 읽음 표시(홈 화면 아이콘 숫자, 브라우저 탭 제목·아이콘)를 사이드바 뱃지와 같은 값으로 맞춘다.
 * 알림과 메시지를 합친 수다. 서비스 워커(`public/push-sw.js`)의 홈 화면 숫자는 근사치라 앱이 뜬 뒤엔 여기가 덮는다.
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

  // 셸을 떠나면(로그아웃 등) 탭 표시를 걷는다. 홈 화면 숫자는 OS가 들고 있어 계정이 바뀔 때
  // `user-scoped-storage`가 지운다.
  useEffect(() => () => setTabBadgeCount(0), []);

  return null;
}
