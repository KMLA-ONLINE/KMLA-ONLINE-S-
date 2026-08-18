import { ArrowLeftIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  useBeforeUnload,
  useBlocker,
  useNavigate,
  useRevalidator,
} from "react-router";

import {
  PostAttachmentEditor,
  PostFormField,
} from "~/features/posts/components/post-attachment-editor";
import { PostBodyInput } from "~/features/posts/components/post-body-input";
import {
  createPostUploadSession,
  createProfilePostWithAttachments,
  updateProfilePostWithAttachments,
} from "~/features/posts/data/mutations";
import {
  preparePostFiles,
  releasePostFile,
} from "~/features/posts/model/attachments";
import { normalizePostMarkdownSource } from "~/features/posts/model/markdown";
import type {
  PostSaveProgress,
  PostVisibility,
  PreparedPostFile,
  ProfilePost,
  ProfilePostFormErrors,
  ProfilePostFormValues,
} from "~/features/posts/model/types";
import {
  hasProfilePostFormErrors,
  readProfilePostForm,
  validateProfilePostForm,
} from "~/features/posts/model/validation";
import { useFileDrop } from "~/shared/hooks/use-file-drop";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";

export function isProfilePostDraftDirty({
  initial,
  body,
  visibility,
  attachmentsChanged,
}: {
  initial: ProfilePostFormValues;
  body: string;
  visibility: PostVisibility;
  attachmentsChanged: boolean;
}): boolean {
  return (
    body !== initial.body ||
    visibility !== initial.visibility ||
    attachmentsChanged
  );
}

/**
 * 개인 게시물 작성·수정 화면 (기능 명세 §8.4, §8.10).
 *
 * 그룹 편집기와 같은 전체화면 껍데기, 같은 본문 입력기, 같은 첨부 편집기를 쓴다. 입력 항목만
 * 다르다 — 제목·카테고리·작성 신원이 없고 공개 범위가 그 자리에 온다.
 *
 * 공개 범위는 자기 타임라인 글에서만 고를 수 있다. 남의 타임라인에 쓴 글은 언제나 전체
 * 공개이므로 고르게 두면 지킬 수 없는 약속이 된다 — 서버도 같은 이유로 되돌린다.
 */
export function ProfilePostEditor({
  mode,
  timelinePubId,
  timelineName,
  canChooseVisibility,
  post,
}: {
  mode: "create" | "edit";
  timelinePubId: string;
  timelineName: string;
  canChooseVisibility: boolean;
  post?: ProfilePost | null;
}) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  // 프로필로 `navigate`하면 히스토리에 작성 화면이 남아서, 뒤로 가기를 누른 사용자가 방금
  // 버린 초안을 다시 마주하게 된다. 들어온 경로를 되감는 게 맞다.
  const close = useModalClose(`/profile/${timelinePubId}`);

  const initial: ProfilePostFormValues = {
    body: post?.body ?? "",
    visibility: post?.visibility ?? "public",
  };
  const [formErrors, setFormErrors] = useState<ProfilePostFormErrors>({});
  const [existing, setExisting] = useState(post?.attachments ?? []);
  const [removedIds, setRemovedIds] = useState(new Set<string>());
  const [additions, setAdditions] = useState<PreparedPostFile[]>([]);
  const [attachmentOrder, setAttachmentOrder] = useState(
    () => post?.attachments.map((item) => item.attachment_id) ?? [],
  );
  const additionsRef = useRef(additions);
  additionsRef.current = additions;
  const bodyRef = useRef(initial.body);
  const [draftBody, setDraftBody] = useState(initial.body);
  const [draftVisibility, setDraftVisibility] = useState(initial.visibility);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<PostSaveProgress | null>(null);
  const session = useRef(createPostUploadSession());
  const totalCount = existing.length + additions.length;
  const originalAttachmentOrder =
    post?.attachments.map((item) => item.attachment_id) ?? [];
  const attachmentsChanged =
    additions.length > 0 ||
    removedIds.size > 0 ||
    attachmentOrder.length !== originalAttachmentOrder.length ||
    attachmentOrder.some(
      (key, index) => key !== originalAttachmentOrder[index],
    );
  const dirty = isProfilePostDraftDirty({
    initial,
    body: draftBody,
    visibility: draftVisibility,
    attachmentsChanged,
  });
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !saving && currentLocation.pathname !== nextLocation.pathname,
  );

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!dirty || saving) return;
        event.preventDefault();
      },
      [dirty, saving],
    ),
  );

  useEffect(() => () => additionsRef.current.forEach(releasePostFile), []);

  const addFiles = async (
    files: FileList | null,
    selection: "image" | "file" | "mixed",
  ) => {
    if (!files?.length || saving) return;
    try {
      const prepared = await preparePostFiles(
        [...files],
        totalCount,
        selection,
      );
      setAdditions((current) => [...current, ...prepared]);
      setAttachmentOrder((current) => [
        ...current,
        ...prepared.map((item) => item.key),
      ]);
      setFormErrors((current) => ({
        ...current,
        form: undefined,
        body: undefined,
      }));
    } catch (error) {
      setFormErrors((current) => ({
        ...current,
        form:
          error instanceof Error
            ? error.message
            : "파일을 준비하지 못했습니다.",
      }));
    }
  };
  const { isDragging, dropHandlers } = useFileDrop(
    (files) => void addFiles(files, "mixed"),
  );

  const save = async (nextValues: ProfilePostFormValues) => {
    setSaving(true);
    setFormErrors({});
    try {
      const onProgress = (state: PostSaveProgress) => setProgress(state);
      const postId =
        mode === "create"
          ? await createProfilePostWithAttachments(
              timelinePubId,
              nextValues,
              additions,
              session.current,
              onProgress,
            )
          : await updateProfilePostWithAttachments(
              post!.post_id,
              nextValues,
              existing,
              removedIds,
              additions,
              attachmentOrder,
              session.current,
              onProgress,
            );
      additions.forEach(releasePostFile);
      await revalidator.revalidate();
      void navigate(`/profile/${timelinePubId}/posts/${postId}`, {
        replace: true,
      });
    } catch (error) {
      setFormErrors({
        form:
          error instanceof Error
            ? error.message
            : "게시물을 저장하지 못했습니다. 다시 시도해 주세요.",
      });
      setSaving(false);
      setProgress(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    // 본문만 폼 밖에서 온다 — Markdown 편집기는 네이티브 폼 필드가 아니라 ref에 싣는다.
    const nextValues: ProfilePostFormValues = {
      ...readProfilePostForm(new FormData(event.currentTarget)),
      body: normalizePostMarkdownSource(bodyRef.current),
    };
    const nextErrors = validateProfilePostForm(
      nextValues,
      totalCount,
      canChooseVisibility,
    );
    if (hasProfilePostFormErrors(nextErrors)) return setFormErrors(nextErrors);
    void save(nextValues);
  };

  const removeExisting = (id: string) => {
    setRemovedIds((current) => new Set(current).add(id));
    setExisting((current) =>
      current.filter((item) => item.attachment_id !== id),
    );
    setAttachmentOrder((current) => current.filter((key) => key !== id));
  };
  const removeAddition = (key: string) => {
    setAdditions((current) => {
      const removed = current.find((item) => item.key === key);
      if (removed) releasePostFile(removed);
      return current.filter((item) => item.key !== key);
    });
    setAttachmentOrder((current) => current.filter((item) => item !== key));
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
  const progressLabel =
    progress === "uploading"
      ? "첨부 업로드 중"
      : progress === "publishing"
        ? "게시 중"
        : "저장 중";

  return (
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-background">
      {/*
        제출은 이 폼이 직접 처리한다. react-router의 `<Form>`을 쓰면 route action으로 간다고
        읽히지만, 첨부 업로드는 초안 생성→prepare→upload→finalize→commit으로 이어지는
        브라우저 I/O라 action 한 번으로 표현할 수 없다.
      */}
      <form
        onSubmit={(event) => void submit(event)}
        onChange={(event) => {
          const target = event.target;
          if (
            target instanceof HTMLSelectElement &&
            target.name === "visibility"
          ) {
            setDraftVisibility(target.value as PostVisibility);
          }
        }}
        className="flex min-h-0 flex-1 flex-col"
        {...dropHandlers}
      >
        <header className="shrink-0 border-b bg-background pt-[env(safe-area-inset-top)] md:border-b-0 md:bg-muted/40">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-3 sm:px-6 md:border-x md:border-b md:bg-background md:shadow-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="작성 화면 닫기"
              onClick={close}
            >
              <ArrowLeftIcon />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-semibold">
                {mode === "create" ? "새 게시물" : "게시물 수정"}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {timelineName}님의 타임라인
              </p>
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : null}{" "}
              {saving ? progressLabel : mode === "create" ? "게시" : "저장"}
            </Button>
          </div>
        </header>

        {/*
          첨부를 더해 내용이 길어지면 스크롤바가 생긴다. 그대로 두면 그 폭만큼 콘텐츠 상자가
          좁아지면서 `mx-auto`로 가운데 둔 본문이 왼쪽으로 밀리는데, 헤더는 이 스크롤 영역
          밖이라 함께 밀리지 않아 둘이 어긋난다. 양쪽에 자리를 미리 잡아 둔다.
        */}
        <main className="min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto md:bg-muted/40">
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-5 sm:px-6 sm:py-8 md:border-x md:bg-background md:shadow-sm">
            {canChooseVisibility ? (
              <PostFormField error={formErrors?.visibility}>
                <NativeSelect
                  name="visibility"
                  defaultValue={initial.visibility}
                  aria-label="공개 범위"
                  className="w-full sm:w-56"
                >
                  <NativeSelectOption value="public">
                    전체 공개
                  </NativeSelectOption>
                  <NativeSelectOption value="private">
                    비공개
                  </NativeSelectOption>
                </NativeSelect>
              </PostFormField>
            ) : (
              <p className="text-sm text-muted-foreground">
                다른 사용자의 타임라인에 남기는 게시물은 전체 공개됩니다.
              </p>
            )}

            <div className="flex min-h-[24rem] flex-1 flex-col pt-5">
              <PostFormField error={formErrors?.body}>
                <PostBodyInput
                  value={draftBody}
                  onValueChange={(value) => {
                    bodyRef.current = value;
                    setDraftBody(value);
                  }}
                />
              </PostFormField>
            </div>

            <PostAttachmentEditor
              existing={existing}
              additions={additions}
              order={attachmentOrder}
              disabled={saving}
              isDragging={isDragging}
              onSelect={addFiles}
              onRemoveExisting={removeExisting}
              onRemoveAddition={removeAddition}
              onMove={move}
            />
            {formErrors?.form ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {formErrors.form}
              </p>
            ) : null}
          </div>
        </main>
      </form>

      {blocker.state === "blocked" ? (
        <ConfirmDialog
          title={
            mode === "create" ? "작성 중인 게시물" : "저장하지 않은 변경 사항"
          }
          description={
            mode === "create"
              ? "작성 중인 본문이나 첨부가 있습니다. 저장하지 않고 나갈까요?"
              : "수정한 내용이 저장되지 않았습니다. 저장하지 않고 나갈까요?"
          }
          confirmLabel="나가기"
          destructive
          onCancel={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
        />
      ) : null}
    </div>
  );
}
