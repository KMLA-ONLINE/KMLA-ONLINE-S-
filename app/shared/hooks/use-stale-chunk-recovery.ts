import { useEffect } from "react";

const reloadPage = () => window.location.reload();

/** 세션 저장소인 이유: 이 탭의 새로고침 한 번만 넘기면 되는 표시라 오래 남을 필요가 없다. */
const RELOAD_MARK_KEY = "kmla-online:chunk-reload:v1";
const RELOAD_COOLDOWN_MS = 30_000;

function readReloadMark(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_MARK_KEY)) || 0;
  } catch {
    // 사파리 프라이빗 모드처럼 저장소 접근 자체가 던지는 환경이 있다.
    return 0;
  }
}

function writeReloadMark(at: number): void {
  try {
    sessionStorage.setItem(RELOAD_MARK_KEY, String(at));
  } catch {
    // 표시를 못 남겨도 되살리기는 시도한다. 아래 `recovered`가 이 페이지 안에서의
    // 반복은 막아 주고, 저장소가 없는 브라우저는 애초에 드물다.
  }
}

/**
 * 배포로 사라진 청크를 만난 탭을 새로고침으로 되살린다.
 *
 * 라우트는 지연 import로 쪼개져 있고 파일 이름에는 콘텐츠 해시가 붙는다. 평소에는 서비스
 * 워커의 precache가 옛 해시를 그대로 갖고 있어서 배포가 나가도 열린 탭이 멀쩡하지만, 다른
 * 탭이 업데이트를 적용해 컨트롤러가 새 워커로 넘어가면 이 탭이 쓰던 청크는 precache에서
 * 지워진다. Vercel도 이전 배포의 `/assets`를 프로덕션 주소로 더는 주지 않으므로, 그 뒤
 * 첫 화면 이동에서 지연 import가 실패한다.
 *
 * 새로고침하면 서비스 워커가 갖고 있는 온전한 한 벌(옛 워커면 옛 index.html, 새 워커면 새
 * index.html)을 다시 받아 오므로 어느 쪽이든 복구된다. `ErrorBoundary`도 결국 같은 곳에
 * 닿지만 그 전에 오류 화면이 한 번 지나간다 — 사용자가 한 일은 링크를 누른 것뿐이라
 * 조용히 넘기는 편이 맞다.
 */
export function useStaleChunkRecovery(reload = reloadPage) {
  useEffect(() => {
    // 개발 서버에서는 청크가 사라지지 않는다. HMR이 낸 오류를 새로고침으로 덮으면
    // 고쳐야 할 것이 안 보인다.
    if (!import.meta.env.PROD) return;

    let recovered = false;

    const onPreloadError = (event: Event) => {
      if (recovered) return;

      // 새 빌드에서도 같은 import가 실패하면(청크 자체가 깨진 배포) 새로고침이 끝없이
      // 돈다. 방금 한 번 되살렸다면 여기서 손을 떼고 `ErrorBoundary`에 넘긴다.
      const now = Date.now();
      if (now - readReloadMark() < RELOAD_COOLDOWN_MS) return;

      // Vite는 이 이벤트가 취소되지 않으면 원래 오류를 다시 던진다. 새로고침으로
      // 처리할 것이므로 오류 화면이 스쳐 지나가지 않게 막는다.
      event.preventDefault();
      recovered = true;
      writeReloadMark(now);
      reload();
    };

    window.addEventListener("vite:preloadError", onPreloadError);
    return () =>
      window.removeEventListener("vite:preloadError", onPreloadError);
  }, [reload]);
}
