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
import { FROM_GROUP } from "~/features/posts/model/navigation";
import { usePostAttachmentDraft } from "~/features/posts/hooks/use-post-attachment-draft";
import { normalizePostMarkdownSource } from "~/features/posts/model/markdown";
import {
  formatPostDate,
  getPostErrorMessage,
} from "~/features/posts/model/format";
import { PostAttachmentEditor } from "~/features/posts/components/editor/post-attachment-editor";
import {
  PostBodyInput,
  type PostBodyInputHandle,
} from "~/features/posts/components/editor/post-body-input";
import { MentionButton } from "~/features/posts/components/mention-button";
import {
  activeMentionPubIds,
  remainingMentions,
  useMentionDraft,
} from "~/features/posts/hooks/use-mention-draft";
import { countMentionTargets } from "~/features/posts/model/mentions";
import {
  PostEditorLayout,
  PostFormField,
} from "~/features/posts/components/editor/post-editor-layout";
import type {
  GroupCategory,
  GroupPostDetail,
  PostFormErrors,
  PostFormValues,
  PostIdentity,
  PostSaveProgress,
  AnonymousActivityRestriction,
} from "~/features/posts/model/types";
import {
  hasPostFormErrors,
  isPostDraftDirty,
  needsPostIdentityConfirmation,
  readPostForm,
  validatePostForm,
} from "~/features/posts/model/validation";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { cn } from "~/shared/lib/utils";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { TextField } from "~/shared/ui/text-field";

export function GroupPostEditor({
  mode,
  slug,
  groupName,
  groupId,
  categories,
  post,
  identities = ["identified"],
  onSaved,
  anonymousActivityRestriction,
}: {
  mode: "create" | "edit";
  slug: string;
  groupName: string;
  groupId: string;
  categories: GroupCategory[];
  post?: GroupPostDetail | null;
  identities?: PostIdentity[];
  onSaved?: () => Promise<void>;
  anonymousActivityRestriction?: AnonymousActivityRestriction | null;
}) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  // 그룹으로 `navigate`하면 히스토리에 작성 화면이 남아서, 뒤로 가기를 누른 사용자가 방금
  // 버린 초안을 다시 마주하게 된다. 들어온 경로를 되감는 게 맞다.
  const close = useModalClose(`/groups/${slug}`);
  // 저장은 이 컴포넌트가 RPC로 직접 돌린다(`AGENTS.md`: 파일 처리·진행률·재시도는 소유
  // 기능에 둔다). route action으로 왕복하지 않으므로 되돌아온 값이 아니라 게시물 자체가
  // 언제나 초기값이다.
  const initial: PostFormValues = {
    title: post?.title ?? "",
    body: post?.body ?? "",
    categoryId: post?.category_id ?? "",
    authorIdentity: post?.author_identity ?? identities[0],
    mentions: [],
  };
  const [formErrors, setFormErrors] = useState<PostFormErrors>({});
  // 수정 화면은 상세 RPC 가 돌려준 `mentions`가 곧 본문 토큰의 번호표다. 새 글은 빈 표에서
  // 시작한다.
  const mentionDraft = useMentionDraft(post?.mentions ?? []);
  const bodyHandle = useRef<PostBodyInputHandle>(null);
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
      // 새 글은 그룹 → 작성 화면 → 상세라 방금 갈아치운 entry 밑이 그룹이다. 수정은 밑이
      // 이전 상세 entry여서 뒤로가기가 한 번에 그룹에 닿지 않으므로 표식을 심지 않는다.
      void navigate(`/groups/${slug}/posts/${postId}`, {
        replace: true,
        state: mode === "create" ? FROM_GROUP : undefined,
      });
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
      mentions: mentionDraft.entries,
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
        onClose={close}
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
            if (target.name === "authorIdentity") {
              const nextIdentity = target.value as PostIdentity;
              if (
                nextIdentity === "anonymous" &&
                countMentionTargets(draftBody, mentionDraft.entries) > 0
              ) {
                setFormErrors((current) => ({
                  ...current,
                  authorIdentity:
                    "멘션을 모두 지운 뒤 익명으로 전환할 수 있습니다.",
                }));
                return;
              }
              setDraftIdentity(nextIdentity);
              setFormErrors((current) => ({
                ...current,
                authorIdentity: undefined,
              }));
            }
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
                  value={draftIdentity}
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

        <div className="pt-5">
          <PostFormField error={formErrors?.body}>
            <PostBodyInput
              value={draftBody}
              handleRef={bodyHandle}
              onValueChange={(value) => {
                bodyRef.current = value;
                setDraftBody(value);
              }}
            />
            {/*
              익명 글은 멘션할 수 없다(기능 명세 §8.14). 운영진 명의는 실제 작성자의 이름과
              사진이 그대로 보이므로(§8.6) 익명이 아니고, 여기서 감추지 않는다.
            */}
            {draftIdentity === "anonymous" ? null : (
              <div className="flex items-center gap-1">
                <MentionButton
                  groupId={groupId}
                  disabled={saving}
                  remaining={remainingMentions(draftBody, mentionDraft.entries)}
                  activeTargetPubIds={activeMentionPubIds(
                    draftBody,
                    mentionDraft.entries,
                  )}
                  onSelect={(candidate) => {
                    const ordinal = mentionDraft.register(candidate, draftBody);
                    if (ordinal === null) return;
                    bodyHandle.current?.insertMention(candidate.name, ordinal);
                  }}
                />
                <span className="text-xs text-muted-foreground">멘션</span>
              </div>
            )}
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
