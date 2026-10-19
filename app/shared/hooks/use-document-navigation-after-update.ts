import { useEffect, useRef } from "react";
import { createPath, useLocation, useNavigation } from "react-router";

const assignPage = (path: string) => window.location.assign(path);

/**
 * 다른 탭이 새 버전을 적용한 뒤, 이 탭의 다음 화면 이동을 문서 이동으로 바꿔 새 버전으로 연다.
 *
 * 그때 이 탭을 다스리는 워커는 이미 새 워커라 옛 화면 파일은 precache에서 지워졌다. 앱 안 이동에
 * 맡기면 아직 열지 않은 화면은 불러오기에 실패하고, 복구 새로고침(`useStaleChunkRecovery`와 React
 * Router의 route module 재시도)은 주소가 바뀌기 전의 화면을 다시 띄워 누른 것이 사라진다. 목적지를
 * 문서로 열면 새 워커가 precache한 index.html이 곧바로 응답하므로 누른 화면에 새 버전으로 도착한다.
 *
 * - 제출(`formMethod`가 있는 이동)은 그대로 둔다. 문서 이동은 GET이라 action을 건너뛴다.
 * - 경로가 같은 이동(검색어, 뷰어 파라미터)은 그대로 둔다. 그 화면 파일은 이미 갖고 있고, 보기를 바꿀
 *   때마다 화면 전체를 다시 불러오면 안 된다.
 * - 뒤로 가기는 브라우저 주소가 이미 목적지라, 같은 주소로의 문서 이동이 기록을 늘리지 않고 그 자리를
 *   다시 불러온다. 앱 안의 replace 이동은 기록을 하나 더 남기는데, 확정 전인 이동의 종류는 알 수 없고
 *   한 번뿐인 일이라 받아들인다.
 */
export function useDocumentNavigationAfterUpdate(
  active: boolean,
  navigateDocument = assignPage,
) {
  const navigation = useNavigation();
  const { pathname } = useLocation();
  const startedRef = useRef(false);

  const target =
    navigation.state === "loading" &&
    navigation.formMethod === undefined &&
    navigation.location.pathname !== pathname
      ? createPath(navigation.location)
      : null;

  useEffect(() => {
    if (!active || target === null || startedRef.current) return;
    startedRef.current = true;
    navigateDocument(target);
  }, [active, target, navigateDocument]);
}
