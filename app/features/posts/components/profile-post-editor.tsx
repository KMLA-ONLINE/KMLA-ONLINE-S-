import { useCallback, useRef, useState, type FormEvent } from "react";
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
import { PostEditorLayout } from "~/features/posts/components/post-editor-layout";
import {
  createProfilePostWithAttachments,
  discardPostUploadDraft,
  discardPostUploads,
  preuploadPostFiles,
  preuploadProfilePostFiles,
  updateProfilePostWithAttachments,
} from "~/features/posts/data/mutations";
import { usePostAttachmentDraft } from "~/features/posts/hooks/use-post-attachment-draft";
import { releasePostFile } from "~/features/posts/model/attachments";
import { normalizePostMarkdownSource } from "~/features/posts/model/markdown";
import type {
  PostSaveProgress,
  PostVisibility,
  ProfilePost,
  ProfilePostFormErrors,
  ProfilePostFormValues,
} from "~/features/posts/model/types";
import {
  hasProfilePostFormErrors,
  readProfilePostForm,
  validateProfilePostForm,
} from "~/features/posts/model/validation";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

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
 * 개인 게시물 작성·수정 화면.
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
  onSaved,
}: {
  mode: "create" | "edit";
  timelinePubId: string;
  timelineName: string;
  canChooseVisibility: boolean;
  post?: ProfilePost | null;
  onSaved?: () => Promise<void>;
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
  const bodyRef = useRef(initial.body);
  const [draftBody, setDraftBody] = useState(initial.body);
  const [draftVisibility, setDraftVisibility] = useState(initial.visibility);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [progress, setProgress] = useState<PostSaveProgress | null>(null);
  const {
    existing,
    removedIds,
    additions,
    attachmentOrder,
    uploadStates,
    preparingCount,
    preparationError,
    clearPreparationError,
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
  } = usePostAttachmentDraft({
    initialAttachments: post?.attachments ?? [],
    disabled: saving,
    preupload: (files, uploadSession) =>
      mode === "create"
        ? preuploadProfilePostFiles(
            timelinePubId,
            draftVisibility,
            files,
            uploadSession,
          )
        : preuploadPostFiles(post!.post_id, files, uploadSession),
    onFilesAdded: () =>
      setFormErrors((current) => ({
        ...current,
        form: undefined,
        body: undefined,
      })),
  });
  const dirty = isProfilePostDraftDirty({
    initial,
    body: draftBody,
    visibility: draftVisibility,
    attachmentsChanged: attachmentsChanged || preparingCount > 0,
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

  const save = async (nextValues: ProfilePostFormValues) => {
    clearPreparationError();
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
      await onSaved?.();
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
    if (preparingCount > 0) {
      setFormErrors((current) => ({
        ...current,
        form: "선택한 파일을 준비하고 있습니다. 잠시만 기다려 주세요.",
      }));
      return;
    }
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

  return (
    <>
      <PostEditorLayout
        mode={mode}
        subtitle={`${timelineName}님의 타임라인`}
        saving={saving}
        preparingCount={preparingCount}
        progress={progress}
        onClose={close}
        formProps={{
          onSubmit: (event) => void submit(event),
          onChange: (event) => {
            const target = event.target;
            if (
              target instanceof HTMLSelectElement &&
              target.name === "visibility"
            ) {
              setDraftVisibility(target.value as PostVisibility);
            }
          },
          ...dropHandlers,
        }}
      >
        {canChooseVisibility ? (
          <PostFormField error={formErrors?.visibility}>
            <NativeSelect
              name="visibility"
              defaultValue={initial.visibility}
              aria-label="공개 범위"
              className="w-full sm:w-56"
            >
              <NativeSelectOption value="public">전체 공개</NativeSelectOption>
              <NativeSelectOption value="private">비공개</NativeSelectOption>
            </NativeSelect>
          </PostFormField>
        ) : (
          <p className="text-sm text-muted-foreground">
            다른 사용자의 타임라인에 남기는 게시물은 전체 공개됩니다.
          </p>
        )}

        <div className="flex min-h-72 flex-1 flex-col pt-5 md:min-h-0 md:flex-none">
          <PostFormField
            className="flex-1 md:flex-none"
            error={formErrors?.body}
          >
            <PostBodyInput
              value={draftBody}
              className="flex-1"
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
          uploadStates={uploadStates}
          onSelect={addFiles}
          onRemoveExisting={removeExisting}
          onRemoveAddition={removeAddition}
          onMove={move}
          onRetry={retry}
        />
        {(preparationError ?? formErrors?.form) ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {preparationError ?? formErrors.form}
          </p>
        ) : null}
      </PostEditorLayout>

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
                if (mode === "create")
                  await discardPostUploadDraft("profile", session.current);
                else await discardPostUploads(session.current);
              } catch {
                // Scheduled cleanup removes any upload rows that could not be deleted now.
              } finally {
                blocker.proceed();
              }
            })();
          }}
        />
      ) : null}
    </>
  );
}
