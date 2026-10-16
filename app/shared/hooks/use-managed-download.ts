import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  canShareFiles,
  fetchFiles,
  saveFiles,
  shareFiles,
  usesManagedDownload,
  type DownloadTarget,
} from "~/shared/lib/file-download";
import { isIOS } from "~/shared/lib/install-platform";

export type ManagedDownloadState =
  | { status: "idle" }
  | { status: "loading"; progress: number | null }
  /** 다 받았고, 저장하는 두 번째 탭을 기다린다. */
  | { status: "ready" }
  /**
   * 저장했다. 어디로 갔는지를 화면을 떠날 때까지 그 자리에 남긴다. 알림으로 띄우면 연달아 저장할 때
   * 쌓여 화면을 가린다.
   */
  | { status: "saved"; location: "downloads" | "share" }
  | { status: "failed" };

/**
 * 휴대폰에서 파일 하나 또는 묶음을 받아 저장하는 상태. 흐름과 이유는 `file-download.ts`에 있다.
 *
 * 받는 중에 다시 탭해도 새로 받지 않는다. 저장한 뒤 다시 탭하면 받아 둔 파일을 다시 저장한다.
 * 언마운트하면 받던 요청을 끊고 파일을 놓는다.
 *
 * `failureMessage`를 주면 실패를 그 자리에 남기지 않고 알림으로 알린 뒤 처음 상태로 돌아간다.
 * 상태 표시가 버튼 자체를 대신하는 곳(뷰어)에서 '다시 받기'가 다른 선택지를 가리지 않게 한다.
 */
export function useManagedDownload({
  failureMessage,
}: { failureMessage?: string } = {}) {
  const [state, setState] = useState<ManagedDownloadState>({ status: "idle" });
  const filesRef = useRef<File[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 공유 시트가 뜨는 사이 한 번 더 탭하면 `navigator.share`가 InvalidStateError로 거절한다.
  // 그것을 공유 실패로 읽고 다운로드 폴더에도 저장하지 않도록, 저장 중의 탭은 무시한다.
  const savingRef = useRef(false);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    filesRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const reset = useCallback(() => {
    clear();
    setState({ status: "idle" });
  }, [clear]);

  const start = useCallback(
    async (targets: readonly DownloadTarget[]) => {
      clear();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ status: "loading", progress: null });

      try {
        const files = await fetchFiles(targets, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) {
              setState({ status: "loading", progress });
            }
          },
        });
        if (controller.signal.aborted) return;
        abortRef.current = null;
        filesRef.current = files;
        setState({ status: "ready" });
      } catch {
        if (controller.signal.aborted) return;
        // 묶음 중 하나가 실패해도 나머지는 계속 받으며 진행률을 알린다. 끊지 않으면 그 알림이
        // 실패 표시를 '받는 중'으로 덮어써, 다시 받을 길이 없어진다.
        controller.abort();
        abortRef.current = null;
        if (failureMessage) {
          toast.error(failureMessage);
          setState({ status: "idle" });
        } else {
          setState({ status: "failed" });
        }
      }
    },
    [clear, failureMessage],
  );

  /**
   * iOS는 공유 시트로 저장한다. 시트에 '파일에 저장'이 있고, 홈 화면 앱에서 Blob을 직접 내려받으면
   * 돌아올 길 없는 미리보기로 열린다. Android 공유 시트에는 기기에 저장하는 항목이 없는 경우가
   * 많아 다운로드 폴더에 저장한다.
   */
  const save = useCallback(async () => {
    const files = filesRef.current;
    if (!files || savingRef.current) return;
    savingRef.current = true;
    try {
      if (isIOS() && canShareFiles(files)) {
        try {
          if (await shareFiles(files)) {
            setState({ status: "saved", location: "share" });
          }
          return;
        } catch {
          // 공유 시트를 열지 못했다. 받아 둔 파일을 버리지 말고 다운로드 폴더로 저장한다.
        }
      }
      saveFiles(files);
      setState({ status: "saved", location: "downloads" });
    } finally {
      savingRef.current = false;
    }
  }, []);

  /**
   * 다운로드 링크의 클릭 핸들러. 링크 다운로드를 쓰는 기기(데스크톱)면 기본 동작을 그대로 둔다.
   * 휴대폰에서는 상태에 따라 받기·저장·다시 받기를 한다.
   */
  const handleClick = useCallback(
    (event: { preventDefault(): void }, targets: readonly DownloadTarget[]) => {
      if (!usesManagedDownload()) return;
      event.preventDefault();
      switch (state.status) {
        case "loading":
          return;
        case "ready":
        case "saved":
          void save();
          return;
        default:
          void start(targets);
      }
    },
    [save, start, state.status],
  );

  return { state, start, save, reset, handleClick };
}

/** 낭독기에 쓰는 상태 문구. 처음 상태는 `null`이다. */
export function managedDownloadLabel(
  state: ManagedDownloadState,
): string | null {
  switch (state.status) {
    case "idle":
      return null;
    case "loading":
      return state.progress === null
        ? "받는 중"
        : `받는 중 ${Math.round(state.progress * 100)}%`;
    case "ready":
      return "다 받음, 눌러서 저장";
    case "saved":
      return state.location === "downloads"
        ? "다운로드 폴더에 저장됨"
        : "저장함";
    case "failed":
      return "받지 못함, 눌러서 다시 받기";
  }
}

/** 파일 이름 아래에 남기는 저장 위치. 다운로드 폴더에 저장했을 때만 있다. */
export function managedDownloadNote(
  state: ManagedDownloadState,
): string | null {
  return state.status === "saved" && state.location === "downloads"
    ? "다운로드 폴더에 저장됨"
    : null;
}
