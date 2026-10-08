import { useEffect } from "react";
import { createPath, useLocation, useNavigation } from "react-router";

const assignPage = (path: string) => window.location.assign(path);

/**
 * 새 빌드가 활성화된 뒤의 첫 화면 이동을 전체 페이지 로드로 바꾼다.
 *
 * 그때 이 페이지는 옛 빌드를 돌리고 있고, 옛 청크는 더 이상 받을 수 없다. 어차피 화면이
 * 바뀌는 순간이라 새로 불러와도 잃는 것이 없고, 사용자에게는 그 한 번의 이동이 조금 느린
 * 것으로만 보인다. 경로가 그대로인 이동(검색 조건, 이미지 뷰어처럼 URL에 담긴 화면 상태)과
 * 폼 제출 뒤의 다시 읽기는 화면을 떠나는 것이 아니므로 건드리지 않는다.
 */
export function useReloadOnNavigation(enabled: boolean, assign = assignPage) {
  const navigation = useNavigation();
  const location = useLocation();
  const next = navigation.location;

  useEffect(() => {
    if (!enabled || navigation.state !== "loading" || !next) return;
    if (navigation.formMethod) return;
    if (next.pathname === location.pathname) return;
    assign(createPath(next));
  }, [
    assign,
    enabled,
    location.pathname,
    navigation.formMethod,
    navigation.state,
    next,
  ]);
}
