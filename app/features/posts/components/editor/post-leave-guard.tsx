import { useCallback, useState, type RefObject } from "react";
import { useBeforeUnload, useBlocker } from "react-router";

import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { useReportUnsavedWork } from "~/shared/lib/unsaved-work";

/** 작성 중인 글을 두고 나가려 할 때 확인을 받는다. 저장 중에는 풀어 두고, 나가면 올려 둔 파일을 치운다(실패해도 막지 않는다). */
export function PostLeaveGuard({
  dirty,
  saving,
  mode,
  disposedRef,
  discard,
}: {
  dirty: boolean;
  saving: boolean;
  mode: "create" | "edit";
  /** 화면이 내려간 뒤에는 업로드 세션이 이미 정리됐으므로 다시 건드리지 않는다. */
  disposedRef: RefObject<boolean>;
  discard: () => Promise<void>;
}) {
  const [discarding, setDiscarding] = useState(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !saving && currentLocation.pathname !== nextLocation.pathname,
  );
  useReportUnsavedWork(dirty && !saving);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!dirty || saving) return;
        event.preventDefault();
      },
      [dirty, saving],
    ),
  );

  if (blocker.state !== "blocked") return null;

  return (
    <ConfirmDialog
      title={mode === "create" ? "작성 중인 게시물" : "저장하지 않은 변경 사항"}
      description={
        mode === "create"
          ? "작성 중인 본문이나 첨부가 있습니다. 저장하지 않고 나갈까요?"
          : "수정한 내용이 저장되지 않았습니다. 저장하지 않고 나갈까요?"
      }
      confirmLabel="나가기"
      destructive
      pending={discarding}
      onCancel={() => {
        if (!disposedRef.current) blocker.reset();
      }}
      onConfirm={() => {
        if (disposedRef.current) return;
        setDiscarding(true);
        disposedRef.current = true;
        void (async () => {
          try {
            await discard();
          } catch {
            // Scheduled cleanup removes any upload rows that could not be deleted now.
          } finally {
            blocker.proceed();
          }
        })();
      }}
    />
  );
}
