import { useEffect } from "react";
import {
  createPath,
  useLocation,
  useNavigation,
  type Location,
} from "react-router";

/**
 * 목적지를 history 항목으로 세운 뒤 문서를 다시 불러온다.
 *
 * `location.assign`이 아니라 이렇게 여는 이유는 둘이다. 앱 안 이동은 이미 시작돼 화면 파일 import가 곧
 * 실패하고, 그때 React Router와 `useStaleChunkRecovery`가 `reload()`를 부른다. 주소가 이미 목적지라
 * 어느 쪽 새로고침이 먼저 와도 같은 곳에 닿는다. 또 React Router가 읽는 항목 모양(`usr`·`key`·`idx`)으로
 * 세우므로 링크가 실어 보낸 location state가 새 문서에도 남는다.
 *
 * 뒤로 가기는 브라우저가 이미 목적지 항목에 와 있으니 그 항목을 그대로 다시 불러온다.
 */
function reloadInto(location: Location) {
  const path = createPath(location);
  if (createPath(window.location) !== path) {
    const { idx = 0 } = (window.history.state ?? {}) as { idx?: number };
    window.history.pushState(
      { usr: location.state as unknown, key: location.key, idx: idx + 1 },
      "",
      path,
    );
  }
  window.location.reload();
}

/**
 * 다른 탭이 새 버전을 적용한 뒤, 이 탭의 다음 화면 이동을 문서 이동으로 바꿔 새 버전으로 연다.
 * 그 상황에서만 마운트한다. 평소에는 화면 이동마다 다시 그릴 이유가 없다.
 *
 * 그때 이 탭을 다스리는 워커는 이미 새 워커라 옛 화면 파일은 precache에서 지워졌다. 앱 안 이동에
 * 맡기면 아직 열지 않은 화면은 불러오기에 실패하고, 복구 새로고침은 주소가 바뀌기 전의 화면을 다시 띄워
 * 누른 것이 사라진다.
 *
 * - 제출(`formMethod`가 있는 이동)은 그대로 둔다. 문서를 다시 불러오면 action을 건너뛴다.
 * - 경로가 같은 이동(검색어, 뷰어 파라미터)은 그대로 둔다. 그 화면 파일은 이미 갖고 있고, 보기를 바꿀
 *   때마다 화면 전체를 다시 불러오면 안 된다.
 * - 앱 안의 replace 이동도 항목을 하나 더 남긴다. 확정 전인 이동의 종류는 알 수 없고 한 번뿐인 일이라
 *   받아들인다.
 */
export function useDocumentNavigationAfterUpdate(openDocument = reloadInto) {
  const navigation = useNavigation();
  const { pathname } = useLocation();

  const target =
    navigation.state === "loading" &&
    navigation.formMethod === undefined &&
    navigation.location.pathname !== pathname
      ? navigation.location
      : null;

  useEffect(() => {
    if (target) openDocument(target);
  }, [target, openDocument]);
}
