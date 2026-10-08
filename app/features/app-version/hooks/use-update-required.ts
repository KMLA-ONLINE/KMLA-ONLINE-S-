import { useEffect, useState } from "react";

import { fetchMinClientVersion } from "~/features/app-version/data/queries";
import { CLIENT_COMPAT_VERSION } from "~/features/app-version/model/client-version";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const CHECK_THROTTLE_MS = 5 * 60 * 1000;

/**
 * 서버가 이 빌드를 더 이상 받지 않는지 확인한다.
 *
 * 배포는 DB 마이그레이션을 먼저 올리고 앱을 나중에 올리며, 새 앱은 사용자가 받아들일 때까지
 * 기다린다. 그 사이 옛 앱은 바뀐 RPC를 부르다 조용히 실패하므로, 호환이 깨지는 배포에서는
 * 화면을 막고 업데이트로 보낸다. 확인 시점은 서비스 워커 업데이트 확인과 같다 — 앱을 열 때,
 * 다시 돌아올 때, 연결이 돌아올 때, 오래 열어 둔 동안 한 시간마다.
 */
export function useUpdateRequired(): boolean {
  const [required, setRequired] = useState(false);

  useEffect(() => {
    // 개발 서버에는 업데이트를 받아 올 서비스 워커가 없어 막으면 풀 방법이 없다.
    if (!import.meta.env.PROD) return;

    let cancelled = false;
    let lastCheckedAt = Number.NEGATIVE_INFINITY;

    const check = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheckedAt < CHECK_THROTTLE_MS) return;
      lastCheckedAt = Date.now();

      fetchMinClientVersion().then(
        (minVersion) => {
          if (!cancelled && minVersion > CLIENT_COMPAT_VERSION) {
            setRequired(true);
          }
        },
        () => {
          // 오프라인이거나 서버가 잠시 응답하지 않는다. 연결이 돌아오면 바로 다시 묻도록
          // 쓰로틀을 풀어 둔다.
          lastCheckedAt = Number.NEGATIVE_INFINITY;
        },
      );
    };

    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, []);

  return required;
}
