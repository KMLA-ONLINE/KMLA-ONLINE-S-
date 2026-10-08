import { WifiOffIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { InstallPrompt } from "~/shared/components/install-prompt";
import { useOffline } from "~/shared/hooks/use-offline";
import { useReloadOnNavigation } from "~/shared/hooks/use-reload-on-navigation";
import { useServiceWorker } from "~/shared/hooks/use-service-worker";
import { useStaleChunkRecovery } from "~/shared/hooks/use-stale-chunk-recovery";
import { setPromptActive } from "~/shared/lib/prompt-coordinator";
import { Spinner } from "~/shared/ui/spinner";

/** 업데이트가 강제된 동안 새 빌드가 배포됐는지 다시 묻는 간격. 배포는 몇 분 걸린다. */
const REQUIRED_UPDATE_POLL_MS = 30 * 1000;

const BANNER_CLASS =
  "fixed inset-x-0 top-[calc(var(--app-safe-t)+1rem)] z-50 mx-auto flex w-[min(28rem,calc(100%-2rem))] items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-lg md:top-auto md:bottom-4";

/**
 * 루트에서 렌더하는 PWA 안내와 앱 업데이트를 한자리에 모은다.
 *
 *  - 연결 끊김 배너: 브라우저가 연결이 없다고 말하는 동안만 나타난다.
 *  - 홈 화면 추가 다이얼로그: 스스로 뜰 때를 판단하므로 항상 렌더한다. 연결 끊김 배너가
 *    떠 있는 동안에는 미룬다. 연결이 없으면 "홈 화면에 추가"는 지금 할 수 있는 일이 아니다.
 *  - 앱 업데이트: 화면에 드러나지 않는다. 새 빌드는 배포되는 대로 활성화되고, 열려 있는
 *    페이지는 잃을 것이 없는 순간 새로 불러온다(`useServiceWorker`, `useReloadOnNavigation`).
 *
 * 화면을 그리지 않는 청크 복구도 여기서 켠다. 배포와 서비스 워커가 얽힌 같은 문제를
 * 다루는 데다, 루트에 단 한 번만 마운트되는 컴포넌트가 여기이기 때문이다.
 *
 * `updateRequired`는 서버가 이 빌드를 더 이상 받지 않는다는 뜻이다(판단은 호출하는 쪽이
 * 한다). 그때는 다른 모든 안내보다 앞서 화면 전체를 막고, 새 빌드가 활성화되는 대로 작성
 * 중인 입력이 있어도 새로 불러온다 — 옛 앱으로는 어차피 저장이 되지 않는다.
 */
export function PwaPrompts({
  updateRequired = false,
}: {
  updateRequired?: boolean;
}) {
  useStaleChunkRecovery();

  const offline = useOffline();
  const { updateActivated, checkForUpdateNow } = useServiceWorker();
  useReloadOnNavigation(updateActivated);

  // 한 번만 자동으로 새로 불러온다. 작성 화면의 떠나기 확인에서 사용자가 머물기를 고르면
  // 그 뒤는 버튼에 맡긴다 — 다시 시도하면 확인 창이 끝없이 뜬다.
  const autoReloadedRef = useRef(false);
  useEffect(() => {
    if (!updateRequired || !updateActivated || autoReloadedRef.current) return;
    autoReloadedRef.current = true;
    window.location.reload();
  }, [updateActivated, updateRequired]);

  // DB가 먼저 배포되고 앱은 몇 분 뒤에 올라온다. 그 사이에는 새 빌드를 계속 묻는다.
  useEffect(() => {
    if (!updateRequired || updateActivated) return;
    checkForUpdateNow();
    const timer = window.setInterval(
      checkForUpdateNow,
      REQUIRED_UPDATE_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [checkForUpdateNow, updateActivated, updateRequired]);

  useEffect(() => {
    setPromptActive("offline", offline);
    return () => setPromptActive("offline", false);
  }, [offline]);

  if (updateRequired) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-required-title"
        aria-describedby="update-required-description"
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background px-6 pt-[var(--app-safe-t)] pb-[var(--app-safe-b)] text-center"
      >
        <h2 id="update-required-title" className="text-lg font-semibold">
          업데이트가 필요합니다
        </h2>
        <p
          id="update-required-description"
          className="max-w-xs text-sm text-muted-foreground"
        >
          {offline
            ? "인터넷에 연결되면 새 버전을 받아 옵니다."
            : "지금 버전은 더 이상 쓸 수 없습니다. 새 버전을 준비하는 대로 자동으로 바뀝니다."}
        </p>
        {!offline && <Spinner />}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          새로고침
        </button>
      </div>
    );
  }

  return (
    <>
      {offline && (
        <div role="status" className={BANNER_CLASS}>
          <WifiOffIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          {/* 오프라인 큐가 없으니 나중에 올라간다는 뜻으로 읽힐 말은 넣지 않는다. */}
          <p className="flex-1 text-sm">인터넷에 연결되어 있지 않아요.</p>
        </div>
      )}
      <InstallPrompt blocked={offline} />
    </>
  );
}
