import { useSyncExternalStore } from "react";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * 상대 시각을 그리는 모든 곳이 공유하는 브라우저 시계. 구독자가 몇 개든 타이머는 하나다.
 *
 * 시계를 읽는 부수효과는 전부 `subscribe()` 안에 있다. `getSnapshot()`은 이 값을 읽기만 하는
 * 순수 함수여야 한다 — React는 커밋되지 않고 버려질 렌더에서도 스냅샷을 읽으므로, 거기서
 * 모듈 상태를 건드리면 타이머 없이 시각만 남는 상태가 만들어진다.
 */
const listeners = new Set<() => void>();
let clientNow = Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (intervalId === null) {
    // 타이머가 멈춰 있던 동안에는 아무도 `clientNow`를 갱신하지 않았다. 다시 시작하는
    // 지금이 유일하게 그 공백을 메울 수 있는 지점이다. 모듈 최상단 초기값도 마찬가지로
    // 낡을 수 있다 — 라우트 청크는 `prefetch="intent"`로 실제 사용보다 먼저 로드된다.
    clientNow = Date.now();
    intervalId = setInterval(() => {
      clientNow = Date.now();
      for (const subscriber of listeners) subscriber();
    }, REFRESH_INTERVAL_MS);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

const getSnapshot = () => clientNow;

/**
 * 지금 시각(ms). 1분마다 갱신된다.
 *
 * 서버 스냅샷을 따로 두지 않는다 — 이 앱은 `ssr: false`라 라우트가 브라우저에서만 렌더되고,
 * 어긋날 서버 시계 자체가 없다. `app/root.tsx`의 import 그래프에서 쓰면 빌드 머신의 시각이
 * HTML에 박히므로, 셸에 시각을 그려야 한다면 그건 이 훅이 아니라 다른 방법이어야 한다.
 */
export function useClientNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
