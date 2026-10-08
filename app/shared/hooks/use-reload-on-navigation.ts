import { useEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigation, type Location } from "react-router";

import { hasUnsavedWork } from "~/shared/lib/unsaved-work";

const reloadPage = () => window.location.reload();

/**
 * 새 빌드가 활성화된 뒤 화면이 바뀌면 그 화면을 새로 불러온다.
 *
 * 그때 이 페이지는 옛 빌드를 돌리고 있다. 화면이 막 바뀐 순간이라 다시 불러와도 잃을 것이
 * 없고, 사용자에게는 그 한 번의 이동이 조금 느린 것으로만 보인다. 이동을 가로채지 않고
 * 끝난 뒤에 새로고침하는 이유는 이동이 남긴 것을 그대로 두기 위해서다 — 새로고침은 기록
 * 항목과 `location.state`를 유지하므로 `replace` 이동도, 상태를 실어 보낸 이동도 그대로다.
 *
 * 경로가 그대로인 이동(검색 조건, 이미지 뷰어처럼 URL에 담긴 화면 상태)은 화면을 떠나는
 * 것이 아니므로 건드리지 않는다. 도착한 화면에 미저장 작업이 있으면 다음 이동으로 미룬다.
 *
 * 돌려주는 ref는 진행 중인 이동의 목적지다. 옛 청크가 사라져 이동 자체가 실패하면
 * `useStaleChunkRecovery`가 지금 화면 대신 그곳을 연다.
 */
export function useReloadOnNavigation(
  enabled: boolean,
  reload = reloadPage,
): RefObject<Location | null> {
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const previousPathname = useRef(pathname);
  const pendingRef = useRef<Location | null>(null);

  const next =
    navigation.state === "loading" && !navigation.formMethod
      ? navigation.location
      : null;
  useEffect(() => {
    pendingRef.current = next && next.pathname !== pathname ? next : null;
  }, [next, pathname]);

  useEffect(() => {
    if (pathname === previousPathname.current) return;
    previousPathname.current = pathname;
    if (!enabled || hasUnsavedWork()) return;
    reload();
  }, [enabled, pathname, reload]);

  return pendingRef;
}
