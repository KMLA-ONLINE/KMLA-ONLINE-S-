import type { MouseEvent } from "react";
import { useLocation, useNavigation } from "react-router";

import { isTabReselectClick } from "~/features/app-shell/model/navigation";

/**
 * 데스크톱의 홈 링크(사이드바 홈, 헤더 로고)가 함께 쓰는 click 처리. 홈 첫 화면에서 다시 누르면
 * 이동하지 않고 `onHomeReselect`를 부른다.
 *
 * 다른 화면으로 가는 이동이 아직 loading이면 위치는 홈이어도 가로채지 않는다. 그 홈 클릭은 진행 중인
 * 이동을 덮어써 홈에 머무르려는 것이라, 막으면 취소하려던 화면으로 그대로 넘어간다.
 */
export function useHomeReselectClick(onHomeReselect: () => void) {
  const location = useLocation();
  const navigation = useNavigation();

  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      navigation.state !== "idle" ||
      !isTabReselectClick(event, location, "/")
    )
      return;
    event.preventDefault();
    onHomeReselect();
  };
}
