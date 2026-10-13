import { useEffect } from "react";
import { useNavigate } from "react-router";

/** 서비스 워커(`public/push-sw.js`)가 알림 클릭 때 보내는 이동 요청. */
interface NavigateRequest {
  type: "navigate";
  path: string;
}

function isNavigateRequest(value: unknown): value is NavigateRequest {
  if (typeof value !== "object" || value === null) return false;
  const { type, path } = value as Record<string, unknown>;
  // 앱 안의 절대 경로만 받는다. `//host`는 다른 출처로 가는 경로다.
  return (
    type === "navigate" &&
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//")
  );
}

/**
 * 알림을 눌렀을 때 이미 떠 있는 창을 다시 불러오지 않고 앱 안에서 이동한다. 서비스 워커가 창에
 * 이동을 부탁하면 router로 옮기고 받았다고 답한다. 답이 없으면(이 hook이 없는 화면, 옛 버전의 창)
 * 서비스 워커가 창을 직접 그 주소로 연다.
 */
export function useServiceWorkerNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      if (!isNavigateRequest(event.data)) return;
      event.ports[0]?.postMessage("navigated");
      void navigate(event.data.path);
    };
    container.addEventListener("message", onMessage);
    return () => container.removeEventListener("message", onMessage);
  }, [navigate]);
}
