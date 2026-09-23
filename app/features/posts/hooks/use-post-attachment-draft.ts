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
import { isPostVideoFile } from "~/features/posts/model/validation";
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
  const additionsByKey = new Map(additions.map((item) => [item.key, item]));
  const orderedAdditions = attachmentOrder.flatMap((key) => {
    const item = additionsByKey.get(key);
    return item ? [item] : [];
  });
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
    const selected = [...files];
    const videos = selected.filter(isPostVideoFile);
    const supported = selected.filter((file) => !isPostVideoFile(file));
    setPreparationError(
      videos.length > 0
        ? videos.length === 1
          ? `동영상은 첨부할 수 없어 제외했습니다: ${videos[0].name}`
          : `동영상 ${videos.length}개는 첨부할 수 없어 제외했습니다.`
        : undefined,
    );
    if (supported.length === 0) return;

    const selectedCount = supported.length;
    const currentCount = attachmentCountRef.current;
    attachmentCountRef.current += selectedCount;
    setPreparingCount((current) => current + selectedCount);
    let preparedCount = 0;
    const controller = new AbortController();
    preparationControllers.current.add(controller);
    try {
      await preparePostFiles(supported, currentCount, selection, {
        // 자리는 고른 순서대로 미리 잡는다. 목록은 `attachmentOrder`를 따라 그려지고 아직
        // 준비되지 않은 key는 건너뛰므로, 준비가 끝난 사진이 제 자리에 들어온다.
        onQueued: (keys) => {
          if (!disposedRef.current)
            setAttachmentOrder((current) => [...current, ...keys]);
        },
        onPrepared: (prepared) => {
          if (disposedRef.current) {
            releasePostFile(prepared);
            return;
          }
          preparedCount += 1;
          setAdditions((current) => [...current, prepared]);
          void preupload([prepared], session.current).catch(() => undefined);
          onFilesAdded?.();
        },
        onError: (error, key) => {
          if (disposedRef.current) return;
          // 준비하지 못한 파일이 차지한 자리를 비운다. 남겨 두면 영영 채워지지 않는다.
          setAttachmentOrder((current) =>
            current.filter((item) => item !== key),
          );
          setPreparationError(error.message);
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
    /**
     * 화면에 보이는 순서대로 정렬한 새 첨부. 새 글 작성이 커밋에 넘기는 배열이 이것이다.
     *
     * `additions`는 준비가 끝난 순서로 쌓이므로 표시 순서와 다르고, 드래그로 바꾼 순서도
     * 담고 있지 않다. 수정 경로는 `attachmentOrder`를 따로 넘겨 업로드 뒤에
     * `resolveAttachmentOrder()`가 같은 변환을 하지만, 작성 경로에는 넘길 자리가 없다.
     */
    orderedAdditions,
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
