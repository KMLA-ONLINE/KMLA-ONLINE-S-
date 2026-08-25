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
  createGroupPostWithAttachments,
  createPostUploadSession,
  updateGroupPostWithAttachments,
} from "~/features/posts/data/mutations";
import {
  preparePostFiles,
  releasePostFile,
} from "~/features/posts/model/attachments";
import { normalizePostMarkdownSource } from "~/features/posts/model/markdown";
import {
  PostAttachmentEditor,
  PostFormField,
} from "~/features/posts/components/post-attachment-editor";
import { PostBodyInput } from "~/features/posts/components/post-body-input";
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
  PreparedPostFile,
} from "~/features/posts/model/types";
import {
  hasPostFormErrors,
  readPostForm,
  validatePostForm,
} from "~/features/posts/model/validation";
import { useFileDrop } from "~/shared/hooks/use-file-drop";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { cn } from "~/shared/lib/utils";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { TextField } from "~/shared/ui/text-field";
import { Spinner } from "~/shared/ui/spinner";

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
}: {
  mode: "create" | "detail" | "edit";
  slug: string;
  groupName: string;
  groupId: string;
  categories?: GroupCategory[];
  post?: GroupPostDetail | null;
  identities?: PostIdentity[];
  /** 상세 모드에서만 쓴다. loader가 게시물과 함께 첫 페이지를 내려준다. */
  comments?: PostCommentPage;
  /** 상세 모드에서만 쓴다. 댓글 입력창 왼쪽 아바타에 들어간다. */
  viewer?: CommentViewer;
  onClose?: () => void;
  action?: string;
  onSaved?: () => Promise<void>;
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
      />
    ) : null;
  }

  return (
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-background">
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
      />
    </div>
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
  const [existing, setExisting] = useState(post?.attachments ?? []);
  const [removedIds, setRemovedIds] = useState(new Set<string>());
  const [additions, setAdditions] = useState<PreparedPostFile[]>([]);
  const [attachmentOrder, setAttachmentOrder] = useState(
    () => post?.attachments.map((item) => item.attachment_id) ?? [],
  );
  const additionsRef = useRef(additions);
  additionsRef.current = additions;
  const bodyRef = useRef(initial.body);
  const [draftTitle, setDraftTitle] = useState(initial.title);
  const [draftBody, setDraftBody] = useState(initial.body);
  const [draftCategoryId, setDraftCategoryId] = useState(initial.categoryId);
  const [draftIdentity, setDraftIdentity] = useState(initial.authorIdentity);
  const [saving, setSaving] = useState(false);
  const [pendingIdentity, setPendingIdentity] = useState<PostFormValues | null>(
    null,
  );
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
  const dirty = isPostDraftDirty({
    mode,
    initial,
    title: draftTitle,
    body: draftBody,
    categoryId: draftCategoryId,
    authorIdentity: draftIdentity,
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

  const save = async (nextValues: PostFormValues) => {
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
    <>
      {/*
        제출은 이 폼이 직접 처리한다. react-router의 `<Form>`을 쓰면 route action으로 간다고
        읽히지만, 첨부 업로드는 초안 생성→prepare→upload→finalize→commit으로 이어지는
        브라우저 I/O라 action 한 번으로 표현할 수 없다.
      */}
      <form
        onSubmit={(event) => void submit(event)}
        onChange={(event) => {
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
              onClick={onClose}
            >
              <ArrowLeftIcon />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-semibold">
                {mode === "create" ? "새 게시물" : "게시물 수정"}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {groupName}
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
          onCancel={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
        />
      ) : null}
    </>
  );
}
