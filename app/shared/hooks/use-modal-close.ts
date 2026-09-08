import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * route로 열린 modal을 닫는다.
 *
 * 목록에서 열었다면 되돌아갈 history entry가 있으므로 `navigate(-1)`이 맞다. 그래야 브라우저
 * 뒤로가기가 방금 닫은 modal을 다시 띄우지 않는다. 반대로 링크를 직접 열어 들어왔다면 pop할
 * entry가 없어서 앱 밖으로 나가버리므로, 그때만 `fallback`으로 replace한다.
 *
 * React Router는 자기가 만들지 않은 첫 entry의 `key`를 `"default"`로 둔다 — 그게 "이 화면이
 * 이 세션의 시작점"이라는 신호다.
 *
 * search param으로 여는 오버레이(`useImageViewerParam`, `useSearchDialogParam`)도 같은 것을
 * 묻지만 근거가 다르다. 그쪽은 자기가 연 entry라 `location.state`에 표식을 심어 두면 되고,
 * route로 열리는 modal은 카드·검색 결과·알림 등 여러 경로에서 들어와 그 링크들이 표식을 심어
 * 줄 이유가 없다. 그래서 여기서만 "세션의 시작점인가"라는 간접 신호를 쓴다.
 */
export function useModalClose(fallback: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const isEntryPoint = location.key === "default";

  return useCallback(() => {
    if (isEntryPoint) void navigate(fallback, { replace: true });
    else void navigate(-1);
  }, [isEntryPoint, navigate, fallback]);
}
