import { useEffect, useRef, useState } from "react";

import {
  createPostUploadSession,
  discardPostFileUpload,
  subscribePostUploadSession,
  type PostUploadSession,
} from "~/features/posts/data/mutations";
import {
  preparePostFiles,
  releasePostFile,
} from "~/features/posts/model/attachments";
import type {
  PostAttachment,
  PostFileUploadState,
  PreparedPostFile,
} from "~/features/posts/model/types";
import { useFileDrop } from "~/shared/hooks/use-file-drop";

type FileSelection = "image" | "file" | "mixed";

export function usePostAttachmentDraft({
  initialAttachments,
  disabled,
  preupload,
  onFilesAdded,
}: {
  initialAttachments: PostAttachment[];
  disabled: boolean;
  preupload: (
    files: PreparedPostFile[],
    session: PostUploadSession,
  ) => Promise<void>;
  onFilesAdded?: () => void;
}) {
  const [existing, setExisting] = useState(initialAttachments);
  const [removedIds, setRemovedIds] = useState(new Set<string>());
  const [additions, setAdditions] = useState<PreparedPostFile[]>([]);
  const [attachmentOrder, setAttachmentOrder] = useState(() =>
    initialAttachments.map((item) => item.attachment_id),
  );
  const [uploadStates, setUploadStates] = useState<
    Record<string, PostFileUploadState>
  >({});
  const [preparingCount, setPreparingCount] = useState(0);
  const [preparationError, setPreparationError] = useState<string>();
  const [initialOrder] = useState(() =>
    initialAttachments.map((item) => item.attachment_id),
  );
  const additionsRef = useRef(additions);
  const session = useRef(createPostUploadSession());
  const disposedRef = useRef(false);
  const preparationControllers = useRef(new Set<AbortController>());
  const totalCount = existing.length + additions.length;
  const attachmentCountRef = useRef(totalCount);
  const attachmentsChanged =
    additions.length > 0 ||
    removedIds.size > 0 ||
    attachmentOrder.length !== initialOrder.length ||
    attachmentOrder.some((key, index) => key !== initialOrder[index]);

  useEffect(() => {
    additionsRef.current = additions;
  }, [additions]);

  useEffect(() => {
    disposedRef.current = false;
    const controllers = preparationControllers.current;
    return () => {
      disposedRef.current = true;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      additionsRef.current.forEach(releasePostFile);
    };
  }, []);

  useEffect(
    () =>
      subscribePostUploadSession(session.current, (key, state) => {
        setUploadStates((current) => {
          const next = { ...current };
          if (state) next[key] = state;
          else delete next[key];
          return next;
        });
      }),
    [],
  );

  const addFiles = async (files: FileList | null, selection: FileSelection) => {
    if (!files?.length || disabled) return;
    const selectedCount = files.length;
    const currentCount = attachmentCountRef.current;
    attachmentCountRef.current += selectedCount;
    setPreparingCount((current) => current + selectedCount);
    let preparedCount = 0;
    const controller = new AbortController();
    preparationControllers.current.add(controller);
    try {
      await preparePostFiles([...files], currentCount, selection, {
        onPrepared: (prepared) => {
          if (disposedRef.current) {
            releasePostFile(prepared);
            return;
          }
          preparedCount += 1;
          setAdditions((current) => [...current, prepared]);
          setAttachmentOrder((current) => [...current, prepared.key]);
          void preupload([prepared], session.current).catch(() => undefined);
          onFilesAdded?.();
        },
        onError: (error) => {
          if (!disposedRef.current) setPreparationError(error.message);
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (disposedRef.current) return;
      setPreparationError(
        error instanceof Error ? error.message : "파일을 준비하지 못했습니다.",
      );
    } finally {
      preparationControllers.current.delete(controller);
      attachmentCountRef.current -= selectedCount - preparedCount;
      if (!disposedRef.current)
        setPreparingCount((current) => current - selectedCount);
    }
  };

  const removeExisting = (id: string) => {
    attachmentCountRef.current -= 1;
    setRemovedIds((current) => new Set(current).add(id));
    setExisting((current) =>
      current.filter((item) => item.attachment_id !== id),
    );
    setAttachmentOrder((current) => current.filter((key) => key !== id));
  };

  const removeAddition = (key: string) => {
    attachmentCountRef.current -= 1;
    setAdditions((current) => {
      const removed = current.find((item) => item.key === key);
      if (removed) releasePostFile(removed);
      return current.filter((item) => item.key !== key);
    });
    setAttachmentOrder((current) => current.filter((item) => item !== key));
    void discardPostFileUpload(key, session.current);
  };

  const move = (index: number, direction: -1 | 1) => {
    setAttachmentOrder((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const retry = (key: string) => {
    const item = additions.find((addition) => addition.key === key);
    if (!item) return;
    void preupload([item], session.current).catch(() => undefined);
  };

  const { isDragging, dropHandlers } = useFileDrop(
    (files) => void addFiles(files, "mixed"),
  );

  return {
    existing,
    removedIds,
    additions,
    attachmentOrder,
    uploadStates,
    preparingCount,
    preparationError,
    clearPreparationError: () => setPreparationError(undefined),
    totalCount,
    attachmentsChanged,
    session,
    disposedRef,
    isDragging,
    dropHandlers,
    addFiles,
    removeExisting,
    removeAddition,
    move,
    retry,
  };
}
