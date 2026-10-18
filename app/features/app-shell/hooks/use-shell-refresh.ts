import { useRef, useState } from "react";

/** 금방 끝나도 표시를 이만큼은 유지한다. 바로 사라지면 눌렀는지 알 수 없다. */
const MINIMUM_REFRESH_INDICATOR_MS = 300;

/**
 * 셸의 명시적 새로고침 하나를 여러 입구(당겨서 새로고침, 데스크톱 홈 재클릭)가 함께 쓴다.
 * 진행 중 표시와 중복 실행 방지를 한 곳에 두어, 입구가 달라도 피드 새 세션을 두 번 열지 않는다.
 */
export function useShellRefresh(onRefresh: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);
  // state는 다음 렌더까지 옛 값이라, 같은 tick에 두 입구가 동시에 눌려도 막도록 ref로 판단한다.
  const runningRef = useRef(false);

  /** 시작했으면 `true`, 이미 진행 중이라 건너뛰었으면 `false`. */
  const refresh = (): boolean => {
    if (runningRef.current) return false;
    runningRef.current = true;
    setRefreshing(true);
    void Promise.allSettled([
      onRefresh(),
      new Promise((resolve) =>
        window.setTimeout(resolve, MINIMUM_REFRESH_INDICATOR_MS),
      ),
    ]).then(() => {
      runningRef.current = false;
      setRefreshing(false);
    });
    return true;
  };

  return { refreshing, refresh };
}
