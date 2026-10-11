import { useEffect, useState } from "react";

/**
 * 끊김을 알리기 전에 두는 유예. 엘리베이터나 지하철에서 몇 초 끊기는 것까지 배너로
 * 알리면 배너 자체가 소음이 된다. 복구는 유예 없이 즉시 반영한다.
 */
const OFFLINE_GRACE_MS = 3000;

/**
 * 브라우저가 "연결이 없다"고 말하는 동안만 `true`.
 *
 * `navigator.onLine`은 음성 방향으로만 믿을 수 있다. `false`면 확실히 끊긴 것이지만
 * `true`는 랜에 붙어 있다는 뜻일 뿐 인터넷이 된다는 보증이 아니다 — 학교 와이파이의
 * 캡티브 포털이 그렇다. 그래서 `false`일 때만 알리고 `true`로는 아무것도 주장하지 않는다.
 * 그쪽은 요청이 정직하게 실패하므로 각 화면의 오류 상태가 맡는다.
 *
 * 알려야 하는 이유는 화면이 아무 말도 하지 않기 때문이다. React Query가 기본값
 * `networkMode: "online"`으로 도는데, 이 값이 `true`인 동안 쿼리는 `paused`로 멈춰
 * 선다 — 에러도 나지 않고 끝나지도 않아서 영영 채워지지 않는 스켈레톤만 남는다.
 * 셸은 프리캐시돼 있어 앱이 멀쩡히 뜨는 것도 원인을 가린다. 연결이 돌아오면 멈춰 둔
 * 쿼리는 알아서 재개되므로, 여기서 할 일은 그동안 무슨 일인지 말해 주는 것뿐이다.
 */
export function useOffline(): boolean {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let graceTimer: number | null = null;

    const clearGrace = () => {
      if (graceTimer === null) return;
      window.clearTimeout(graceTimer);
      graceTimer = null;
    };

    const sync = () => {
      clearGrace();

      if (navigator.onLine) {
        setOffline(false);
        return;
      }

      graceTimer = window.setTimeout(() => setOffline(true), OFFLINE_GRACE_MS);
    };

    // 이미 끊긴 채로 마운트되는 경우가 있다. 앱을 오프라인에서 여는 길이 열려 있다.
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    return () => {
      clearGrace();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return offline;
}
