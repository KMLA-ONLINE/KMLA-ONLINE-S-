import { WifiOffIcon } from "lucide-react";

import { InstallPrompt } from "~/shared/components/install-prompt";
import { useOffline } from "~/shared/hooks/use-offline";
import { useServiceWorker } from "~/shared/hooks/use-service-worker";
import { useStaleChunkRecovery } from "~/shared/hooks/use-stale-chunk-recovery";
import { useEffect } from "react";
import {
  setPromptActive,
  usePromptActive,
} from "~/shared/lib/prompt-coordinator";

/**
 * 두 배너는 같은 자리를 쓴다. 겹치지 않는 것은 아래 우선순위가 보장한다 — 연결이 끊긴
 * 동안에는 서비스 워커 배너를 아예 그리지 않는다.
 */
const BANNER_CLASS =
  "fixed inset-x-0 top-[calc(var(--app-safe-t)+1rem)] z-50 mx-auto flex w-[min(28rem,calc(100%-2rem))] items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-lg md:top-auto md:bottom-4";

/**
 * 루트에서 렌더하는 PWA 안내를 한자리에 모은다.
 *
 *  - 연결 끊김 배너: 브라우저가 연결이 없다고 말하는 동안만 나타난다.
 *  - 서비스 워커 배너: 새 빌드가 대기 중이거나 오프라인 준비가 끝났을 때만 나타난다.
 *  - 홈 화면 추가 다이얼로그: 스스로 뜰 때를 판단하므로 항상 렌더한다.
 *
 * 한 컴포넌트에 둔 이유는 서로 자리를 다투기 때문이다. 셋 다 같은 구석에 뜨는 데다,
 * 배너가 떠 있는 동안에는 설치 모달을 미뤄야 한다. 상태를 아는 곳이 여기뿐이라
 * `blocked`를 여기서 내려 준다.
 *
 * 우선순위는 연결 끊김 > 서비스 워커 > 설치다. 연결이 없으면 다른 둘은 지금 할 수
 * 있는 일이 아니고("새로고침"도 "홈 화면에 추가"도), 사용자가 알아야 할 것은 왜 화면이
 * 채워지지 않는지 하나다.
 *
 * 화면을 그리지 않는 청크 복구도 여기서 켠다. 배포와 서비스 워커가 얽힌 같은 문제를
 * 다루는 데다, 루트에 단 한 번만 마운트되는 컴포넌트가 여기이기 때문이다.
 */
export function PwaPrompts() {
  useStaleChunkRecovery();

  const offline = useOffline();
  const {
    updateReady,
    offlineReady,
    applyingUpdate,
    updateAppliedElsewhere,
    applyUpdate,
    dismissOfflineReady,
  } = useServiceWorker();
  const showServiceWorkerPrompt = !offline && (updateReady || offlineReady);
  const notificationPromptActive = usePromptActive("notification");

  useEffect(() => {
    setPromptActive("offline", offline);
    return () => setPromptActive("offline", false);
  }, [offline]);

  useEffect(() => {
    setPromptActive("service-worker", showServiceWorkerPrompt);
    return () => setPromptActive("service-worker", false);
  }, [showServiceWorkerPrompt]);

  return (
    <>
      {offline && (
        <div role="status" className={BANNER_CLASS}>
          <WifiOffIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          {/* 오프라인 큐가 없다. 쓴 글이 나중에 올라간다는 뜻으로 읽힐 말은 넣지 않는다. */}
          <p className="flex-1 text-sm">인터넷에 연결되어 있지 않아요.</p>
        </div>
      )}

      {showServiceWorkerPrompt && (
        <div role="status" className={BANNER_CLASS}>
          <p className="flex-1 text-sm">
            {applyingUpdate
              ? "업데이트를 적용하고 있습니다."
              : updateAppliedElsewhere
                ? "새 버전이 적용됐습니다. 새로고침하면 사용할 수 있습니다."
                : updateReady
                  ? "새 버전이 준비됐습니다."
                  : "오프라인에서도 사용할 수 있습니다."}
          </p>
          {updateReady ? (
            <button
              type="button"
              onClick={applyUpdate}
              disabled={applyingUpdate}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {applyingUpdate ? "적용 중" : "새로고침"}
            </button>
          ) : (
            <button
              type="button"
              onClick={dismissOfflineReady}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground"
            >
              닫기
            </button>
          )}
        </div>
      )}
      <InstallPrompt
        blocked={offline || showServiceWorkerPrompt || notificationPromptActive}
      />
    </>
  );
}
