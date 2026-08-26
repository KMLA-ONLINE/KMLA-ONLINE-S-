import { InstallPrompt } from "~/shared/components/install-prompt";
import { useServiceWorker } from "~/shared/hooks/use-service-worker";
import { useEffect } from "react";
import {
  setPromptActive,
  usePromptActive,
} from "~/shared/lib/prompt-coordinator";

/**
 * 루트에서 렌더하는 PWA 안내 두 가지를 한자리에 모은다.
 *
 *  - 서비스 워커 배너: 새 빌드가 대기 중이거나 오프라인 준비가 끝났을 때만 나타난다.
 *  - 홈 화면 추가 다이얼로그: 스스로 뜰 때를 판단하므로 항상 렌더한다.
 *
 * 둘을 한 컴포넌트에 둔 이유는 배너가 떠 있는 동안 설치 모달을 미뤄야 하기 때문이다.
 * 서비스 워커 상태를 아는 곳이 여기뿐이라 `blocked`를 여기서 내려 준다.
 */
export function PwaPrompts() {
  const {
    updateReady,
    offlineReady,
    applyingUpdate,
    updateAppliedElsewhere,
    applyUpdate,
    dismissOfflineReady,
  } = useServiceWorker();
  const showServiceWorkerPrompt = updateReady || offlineReady;
  const notificationPromptActive = usePromptActive("notification");

  useEffect(() => {
    setPromptActive("service-worker", showServiceWorkerPrompt);
    return () => setPromptActive("service-worker", false);
  }, [showServiceWorkerPrompt]);

  return (
    <>
      {showServiceWorkerPrompt && (
        <div
          role="status"
          className="fixed inset-x-0 top-[calc(var(--app-safe-t)+1rem)] z-50 mx-auto flex w-[min(28rem,calc(100%-2rem))] items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-lg md:top-auto md:bottom-4"
        >
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
        blocked={showServiceWorkerPrompt || notificationPromptActive}
      />
    </>
  );
}
