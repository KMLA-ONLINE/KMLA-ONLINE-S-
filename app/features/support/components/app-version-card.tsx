import { useState } from "react";

import {
  useAppUpdate,
  type UpdateCheckResult,
} from "~/shared/hooks/use-service-worker";
import { appBuild, formatAppBuild } from "~/shared/lib/app-build";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

const CHECK_MESSAGE: Record<UpdateCheckResult, string> = {
  latest: "최신 버전을 사용하고 있습니다.",
  found: "새 버전을 받고 있습니다. 잠시 후 적용할 수 있습니다.",
  failed: "확인하지 못했습니다. 인터넷 연결을 확인해 주세요.",
};

/**
 * 지금 쓰는 빌드와 새 버전 확인(기능 명세 §15.12). 새 버전이 오면 화면 위 안내와 같은 적용을 부른다.
 * 업데이트는 사용자가 받아들일 때만 적용되므로, 안내를 닫아 둔 사람이 여기서 다시 적용할 수 있다.
 */
export function AppVersionCard() {
  const {
    updateReady,
    applyingUpdate,
    updateAppliedElsewhere,
    checkForUpdate,
    applyUpdate,
  } = useAppUpdate();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);

  const check = async () => {
    if (!checkForUpdate || checking) return;
    setChecking(true);
    setResult(null);
    try {
      setResult(await checkForUpdate());
    } finally {
      setChecking(false);
    }
  };

  const message = updateReady
    ? updateAppliedElsewhere
      ? "새 버전이 적용됐습니다. 새로고침하면 사용할 수 있습니다."
      : "새 버전이 준비됐습니다."
    : !checkForUpdate
      ? "이 환경에서는 업데이트를 확인할 수 없습니다."
      : result
        ? CHECK_MESSAGE[result]
        : null;

  return (
    <section
      aria-label="앱 버전"
      className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          앱 버전{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {formatAppBuild(appBuild)}
          </span>
        </p>
        {message ? (
          <p role="status" className="mt-0.5 text-xs text-muted-foreground">
            {message}
          </p>
        ) : null}
      </div>

      {updateReady ? (
        <Button size="sm" onClick={applyUpdate} disabled={applyingUpdate}>
          {applyingUpdate ? <Spinner aria-hidden /> : null}
          {applyingUpdate ? "적용 중" : "새로고침"}
        </Button>
      ) : checkForUpdate ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void check()}
          disabled={checking}
        >
          {checking ? <Spinner aria-hidden /> : null}
          {checking ? "확인 중" : "지금 확인"}
        </Button>
      ) : null}
    </section>
  );
}
