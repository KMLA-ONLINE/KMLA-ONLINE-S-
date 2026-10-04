import { useServiceWorker } from "./use-service-worker";

/**
 * Bottom-of-screen prompt shown when a newer build is waiting to activate.
 * Rendered from the root route; renders nothing until the SW reports a change.
 */
export function ServiceWorkerUpdatePrompt() {
  const { updateReady, offlineReady, applyUpdate, dismissOfflineReady } =
    useServiceWorker();

  if (!updateReady && !offlineReady) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(28rem,calc(100%-2rem))] items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-lg"
    >
      <p className="flex-1 text-sm">
        {updateReady
          ? "새 버전이 준비됐습니다."
          : "오프라인에서도 사용할 수 있습니다."}
      </p>
      {updateReady ? (
        <button
          type="button"
          onClick={applyUpdate}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          새로고침
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
  );
}
