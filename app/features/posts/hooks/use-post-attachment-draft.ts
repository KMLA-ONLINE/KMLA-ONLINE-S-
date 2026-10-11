import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";

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
import { clipboardImageFiles } from "~/shared/lib/clipboard";

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

  const addFiles = async (
    files: FileList | readonly File[] | null,
    selection: FileSelection,
  ) => {
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

  // 첨부할 수 있을 때만 붙여넣기를 가로챈다. 저장 중이거나 첨부할 이미지가 없으면 원래 붙여넣기로 둔다.
  const takePastedImages = (event: {
    clipboardData: DataTransfer | null;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    if (disabled) return;
    const files = clipboardImageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void addFiles(files, "image");
  };

  // 캡처 단계에서 받는다. 본문 편집기(ProseMirror)가 버블 단계에서 붙여넣기를 먼저 처리해 버리고,
  // 폼 안 어느 칸에 포커스가 있든(제목, 본문) 같은 첨부로 들어가야 한다.
  const pasteHandlers = {
    onPasteCapture: (event: ClipboardEvent) => takePastedImages(event),
  };

  // 첨부 목록이나 여백처럼 포커스를 받지 않는 곳을 누르면 포커스가 `body`로 가서 붙여넣기가 폼에
  // 닿지 않는다. 그 경우만 문서에서 받는다. 폼 밖 입력칸(헤더 검색 등)의 붙여넣기는 건드리지 않는다.
  const onDocumentPaste = useEffectEvent((event: globalThis.ClipboardEvent) => {
    if (event.target === document.body) takePastedImages(event);
  });
  useEffect(() => {
    document.addEventListener("paste", onDocumentPaste);
    return () => document.removeEventListener("paste", onDocumentPaste);
  }, []);

  return {
    existing,
    removedIds,
    additions,
    /** 표시 순서로 정렬한 새 첨부. `additions`는 준비 완료 순이라 표시 순서와 달라, 작성 경로는 이 배열을 커밋에 넘긴다. */
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
    pasteHandlers,
    addFiles,
    removeExisting,
    removeAddition,
    move,
    retry,
  };
}
