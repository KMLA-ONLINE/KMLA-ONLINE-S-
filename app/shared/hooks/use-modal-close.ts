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
