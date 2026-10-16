import { CheckIcon, DownloadIcon, RotateCwIcon } from "lucide-react";

import {
  managedDownloadNote,
  type ManagedDownloadState,
} from "~/shared/hooks/use-managed-download";
import { cn } from "~/shared/lib/utils";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 파일 행 오른쪽 끝의 다운로드 표시. 휴대폰에서 받는 중·저장 대기·저장함·실패를 그 자리에서 보인다.
 * 문구는 행의 `aria-label`이 읽으므로 여기서는 모두 장식이다.
 */
export function DownloadStatus({
  state,
  className,
}: {
  state: ManagedDownloadState;
  className?: string;
}) {
  const iconClass = cn("size-4 shrink-0 text-muted-foreground", className);

  switch (state.status) {
    case "idle":
      return <DownloadIcon aria-hidden className={iconClass} />;
    case "loading":
      return (
        <span
          aria-hidden
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums"
        >
          {state.progress === null
            ? null
            : `${Math.round(state.progress * 100)}%`}
          <Spinner aria-hidden />
        </span>
      );
    case "ready":
      return (
        <span
          aria-hidden
          className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
        >
          저장
        </span>
      );
    case "saved":
      return (
        <CheckIcon aria-hidden className={cn(iconClass, "text-primary")} />
      );
    case "failed":
      return (
        <span
          aria-hidden
          className="flex shrink-0 items-center gap-1 text-xs text-destructive"
        >
          <RotateCwIcon className="size-3.5" />
          다시 받기
        </span>
      );
  }
}

/** 파일 이름 아래 줄에 남기는 저장 위치. 알림 대신 그 자리에 둔다(`ManagedDownloadState`의 `saved`). */
export function DownloadNote({ state }: { state: ManagedDownloadState }) {
  const note = managedDownloadNote(state);
  return note ? (
    <span aria-hidden className="block text-xs text-primary">
      {note}
    </span>
  ) : null;
}
