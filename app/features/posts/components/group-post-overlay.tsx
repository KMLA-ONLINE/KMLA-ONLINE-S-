import { useCallback, useRef, useState, type FormEvent } from "react";
import {
  useBeforeUnload,
  useBlocker,
  useNavigate,
  useRevalidator,
} from "react-router";

import {
  createGroupPostWithAttachments,
  discardPostUploadDraft,
  discardPostUploads,
  preuploadGroupPostFiles,
  preuploadPostFiles,
  updateGroupPostWithAttachments,
} from "~/features/posts/data/mutations";
import { releasePostFile } from "~/features/posts/model/attachments";
import { usePostAttachmentDraft } from "~/features/posts/hooks/use-post-attachment-draft";
import { normalizePostMarkdownSource } from "~/features/posts/model/markdown";
import {
  formatPostDate,
  getPostErrorMessage,
} from "~/features/posts/model/format";
import {
  PostAttachmentEditor,
  PostFormField,
} from "~/features/posts/components/post-attachment-editor";
import { PostBodyInput } from "~/features/posts/components/post-body-input";
import { PostEditorLayout } from "~/features/posts/components/post-editor-layout";
import type { CommentViewer } from "~/features/posts/components/comment-composer";
import { PostDetail } from "~/features/posts/components/post-detail";
import type {
  GroupCategory,
  GroupPostDetail,
  PostCommentPage,
  PostFormErrors,
  PostFormValues,
  PostIdentity,
  PostSaveProgress,
  AnonymousActivityRestriction,
} from "~/features/posts/model/types";
import {
  hasPostFormErrors,
  readPostForm,
  validatePostForm,
} from "~/features/posts/model/validation";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { cn } from "~/shared/lib/utils";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { TextField } from "~/shared/ui/text-field";

export function needsPostIdentityConfirmation(identity: PostIdentity): boolean {
  return identity === "staff" || identity === "anonymous";
}

export function isPostDraftDirty({
  mode: _mode,
  initial,
  title,
  body,
  categoryId,
  authorIdentity,
  attachmentsChanged,
}: {
  mode: "create" | "edit";
  initial: PostFormValues;
  title: string;
  body: string;
  categoryId: string;
  authorIdentity: PostIdentity;
  attachmentsChanged: boolean;
}): boolean {
  return (
    title !== initial.title ||
    body !== initial.body ||
    categoryId !== initial.categoryId ||
    authorIdentity !== initial.authorIdentity ||
    attachmentsChanged
  );
}

export function GroupPostOverlay({
  mode,
  slug,
  groupName,
  groupId,
  categories = [],
  post,
  identities = ["identified"],
  comments,
  viewer,
  onClose,
  action,
  onSaved,
  anonymousActivityRestriction,
}: {
  mode: "create" | "detail" | "edit";
  slug: string;
  groupName: string;
  groupId: string;
  categories?: GroupCategory[];
  post?: GroupPostDetail | null;
  identities?: PostIdentity[];
  comments?: PostCommentPage;
  viewer?: CommentViewer;
  onClose?: () => void;
  action?: string;
  onSaved?: () => Promise<void>;
  anonymousActivityRestriction?: AnonymousActivityRestriction | null;
}) {
  // 그룹으로 `navigate`하면 히스토리에 작성 화면이 남아서, 뒤로 가기를 누른 사용자가 방금
  // 버린 초안을 다시 마주하게 된다. 들어온 경로를 되감는 게 맞다.
  const close = useModalClose(`/groups/${slug}`);

  if (mode === "detail") {
    return post && comments && viewer ? (
      <PostDetail
        post={post}
        slug={slug}
        viewer={viewer}
        identities={identities}
        comments={comments}
        onClose={onClose}
        action={action}
        anonymousActivityRestriction={anonymousActivityRestriction}
      />
    ) : null;
  }

  return (
    <PostEditor
      mode={mode}
      slug={slug}
      groupName={groupName}
      groupId={groupId}
      categories={categories}
      post={post}
      identities={identities}
      onClose={close}
      onSaved={onSaved}
      anonymousActivityRestriction={anonymousActivityRestriction}
    />
  );
}

function PostEditor({
  mode,
  slug,
  groupName,
  groupId,
  categories,
  post,
  identities,
  onClose,
  onSaved,
  anonymousActivityRestriction,
}: {
  mode: "create" | "edit";
  slug: string;
  groupName: string;
  groupId: string;
  categories: GroupCategory[];
  post?: GroupPostDetail | null;
  identities: PostIdentity[];
  onClose: () => void;
  onSaved?: () => Promise<void>;
  anonymousActivityRestriction?: AnonymousActivityRestriction | null;
}) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  // 저장은 이 컴포넌트가 RPC로 직접 돌린다(`AGENTS.md`: 파일 처리·진행률·재시도는 소유
  // 기능에 둔다). route action으로 왕복하지 않으므로 되돌아온 값이 아니라 게시물 자체가
  // 언제나 초기값이다.
  const initial: PostFormValues = {
    title: post?.title ?? "",
    body: post?.body ?? "",
    categoryId: post?.category_id ?? "",
    authorIdentity: post?.author_identity ?? identities[0],
  };
  const [formErrors, setFormErrors] = useState<PostFormErrors>({});
  const bodyRef = useRef(initial.body);
  const [draftTitle, setDraftTitle] = useState(initial.title);
  const [draftBody, setDraftBody] = useState(initial.body);
  const [draftCategoryId, setDraftCategoryId] = useState(initial.categoryId);
  const [draftIdentity, setDraftIdentity] = useState(initial.authorIdentity);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [pendingIdentity, setPendingIdentity] = useState<PostFormValues | null>(
    null,
  );
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
        ? preuploadGroupPostFiles(groupId, draftIdentity, files, uploadSession)
        : preuploadPostFiles(post!.post_id, files, uploadSession),
    onFilesAdded: () =>
      setFormErrors((current) => ({
        ...current,
        form: undefined,
        body: undefined,
      })),
  });
  const dirty = isPostDraftDirty({
    mode,
    initial,
    title: draftTitle,
    body: draftBody,
    categoryId: draftCategoryId,
    authorIdentity: draftIdentity,
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

  const save = async (nextValues: PostFormValues) => {
    clearPreparationError();
    setSaving(true);
    setFormErrors({});
    try {
      const onProgress = (state: PostSaveProgress) => setProgress(state);
      const postId =
        mode === "create"
          ? await createGroupPostWithAttachments(
              groupId,
              nextValues,
              additions,
              session.current,
              onProgress,
            )
          : await updateGroupPostWithAttachments(
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
      void navigate(`/groups/${slug}/posts/${postId}`, { replace: true });
    } catch (error) {
      setFormErrors({
        form: getPostErrorMessage(error),
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
    const nextValues: PostFormValues = {
      ...readPostForm(new FormData(event.currentTarget)),
      body: normalizePostMarkdownSource(bodyRef.current),
    };
    const nextErrors = validatePostForm(
      nextValues,
      totalCount,
      mode === "create" ? identities : undefined,
      categories.map((category) => category.id),
    );
    if (hasPostFormErrors(nextErrors)) return setFormErrors(nextErrors);
    if (
      mode === "create" &&
      needsPostIdentityConfirmation(nextValues.authorIdentity)
    ) {
      setPendingIdentity(nextValues);
      return;
    }
    void save(nextValues);
  };

  return (
    <>
      <PostEditorLayout
        mode={mode}
        subtitle={groupName}
        saving={saving}
        preparingCount={preparingCount}
        progress={progress}
        onClose={onClose}
        formProps={{
          onSubmit: (event) => void submit(event),
          onChange: (event) => {
            const target = event.target;
            if (!(
              target instanceof HTMLInputElement ||
              target instanceof HTMLSelectElement
            )) {
              return;
            }
            if (target.name === "title") setDraftTitle(target.value);
            if (target.name === "categoryId") setDraftCategoryId(target.value);
            if (target.name === "authorIdentity")
              setDraftIdentity(target.value as PostIdentity);
          },
          ...dropHandlers,
        }}
      >
        {mode === "create" && anonymousActivityRestriction ? (
          <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            익명 활동이 제한되어 있습니다. 사유:{" "}
            {anonymousActivityRestriction.reason}
            {" · "}만료:{" "}
            {formatPostDate(anonymousActivityRestriction.expires_at)}
          </p>
        ) : null}
        <div className="grid gap-2">
          <div
            className={cn(
              "grid gap-2",
              mode === "create" && identities.length > 1 && "grid-cols-2",
            )}
          >
            <PostFormField error={formErrors?.categoryId}>
              <NativeSelect
                name="categoryId"
                defaultValue={initial.categoryId}
                aria-label="카테고리"
                className="w-full"
              >
                <NativeSelectOption value="">미분류</NativeSelectOption>
                {categories.map((category) => (
                  <NativeSelectOption key={category.id} value={category.id}>
                    {category.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </PostFormField>
            {mode === "create" && identities.length > 1 ? (
              <PostFormField error={formErrors?.authorIdentity}>
                <NativeSelect
                  name="authorIdentity"
                  defaultValue={initial.authorIdentity}
                  aria-label="작성 신원"
                  className="w-full"
                >
                  {identities.map((identity) => (
                    <NativeSelectOption key={identity} value={identity}>
                      {identity === "identified"
                        ? "실명"
                        : identity === "anonymous"
                          ? "익명"
                          : "운영진"}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </PostFormField>
            ) : (
              <input
                type="hidden"
                name="authorIdentity"
                value={initial.authorIdentity}
              />
            )}
          </div>

          <PostFormField error={formErrors?.title}>
            <TextField
              name="title"
              defaultValue={initial.title}
              maxLength={100}
              required
              aria-label="제목"
              placeholder="제목"
              className="h-9 rounded-md text-base font-medium"
            />
          </PostFormField>
        </div>

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
      {pendingIdentity ? (
        <ConfirmDialog
          title={
            pendingIdentity.authorIdentity === "staff"
              ? "운영진 명의로 작성"
              : "익명으로 작성"
          }
          description={
            pendingIdentity.authorIdentity === "staff"
              ? "이 게시물은 그룹 운영진 명의로 표시됩니다. 게시할까요?"
              : "이 게시물은 작성자의 이름을 표시하지 않습니다. 익명으로 게시할까요?"
          }
          confirmLabel="게시"
          pending={saving}
          onCancel={() => setPendingIdentity(null)}
          onConfirm={() => {
            const values = pendingIdentity;
            setPendingIdentity(null);
            void save(values);
          }}
        />
      ) : null}
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
                  await discardPostUploadDraft("group", session.current);
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
