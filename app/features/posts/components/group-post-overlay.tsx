import {
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FileIcon,
  ImagePlusIcon,
  PaperclipIcon,
  Trash2Icon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Form,
  useBeforeUnload,
  useBlocker,
  useNavigate,
  useNavigation,
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
import { PostBodyInput } from "~/features/posts/components/post-body-input";
import type { CommentViewer } from "~/features/posts/components/comment-composer";
import { PostDetail } from "~/features/posts/components/post-detail";
import type {
  GroupCategory,
  GroupPostDetail,
  PostCommentPage,
  PostFormErrors,
  PostFormValues,
  PostAttachment,
  PostIdentity,
  PostSaveProgress,
  PreparedPostFile,
} from "~/features/posts/model/types";
import {
  hasPostFormErrors,
  validatePostForm,
} from "~/features/posts/model/validation";
import { useFileDrop } from "~/shared/hooks/use-file-drop";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { cn } from "~/shared/lib/utils";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";

export function needsPostIdentityConfirmation(
  identity: PostIdentity,
  alwaysAnonymous: boolean,
): boolean {
  return identity === "staff" || (identity === "anonymous" && !alwaysAnonymous);
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
  values,
  errors,
  identities = ["identified"],
  alwaysAnonymous = false,
  comments,
  viewer,
}: {
  mode: "create" | "detail" | "edit";
  slug: string;
  groupName: string;
  groupId: string;
  categories?: GroupCategory[];
  post?: GroupPostDetail | null;
  values?: PostFormValues;
  errors?: PostFormErrors;
  identities?: PostIdentity[];
  alwaysAnonymous?: boolean;
  /** 상세 모드에서만 쓴다. loader가 게시물과 함께 첫 페이지를 내려준다. */
  comments?: PostCommentPage;
  /** 상세 모드에서만 쓴다. 댓글 입력창 왼쪽 아바타에 들어간다. */
  viewer?: CommentViewer;
}) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
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
        values={values}
        errors={errors}
        identities={identities}
        alwaysAnonymous={alwaysAnonymous}
        pending={pending}
        onClose={close}
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
  values,
  errors,
  identities,
  alwaysAnonymous,
  pending,
  onClose,
}: {
  mode: "create" | "edit";
  slug: string;
  groupName: string;
  groupId: string;
  categories: GroupCategory[];
  post?: GroupPostDetail | null;
  values?: PostFormValues;
  errors?: PostFormErrors;
  identities: PostIdentity[];
  alwaysAnonymous: boolean;
  pending: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const original: PostFormValues = {
    title: post?.title ?? "",
    body: post?.body ?? "",
    categoryId: post?.category_id ?? "",
    authorIdentity: post?.author_identity ?? identities[0],
  };
  const initial = values ?? original;
  const [formErrors, setFormErrors] = useState(errors);
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
    initial: original,
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
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const nextValues: PostFormValues = {
      title: text("title").trim(),
      body: normalizePostMarkdownSource(bodyRef.current),
      categoryId: text("categoryId"),
      authorIdentity: (text("authorIdentity") || "identified") as PostIdentity,
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
      needsPostIdentityConfirmation(nextValues.authorIdentity, alwaysAnonymous)
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
      <Form
        method="post"
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
        <input type="hidden" name="intent" value={mode} />
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
            <Button type="submit" disabled={pending || saving}>
              {pending || saving ? <Spinner /> : null}{" "}
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
                <Field error={formErrors?.categoryId}>
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
                </Field>
                {mode === "create" && identities.length > 1 ? (
                  <Field error={formErrors?.authorIdentity}>
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
                  </Field>
                ) : (
                  <input
                    type="hidden"
                    name="authorIdentity"
                    value={initial.authorIdentity}
                  />
                )}
              </div>

              <Field error={formErrors?.title}>
                <Input
                  name="title"
                  defaultValue={initial.title}
                  maxLength={100}
                  required
                  aria-label="제목"
                  placeholder="제목"
                  className="h-9 rounded-md text-base font-medium"
                />
              </Field>
            </div>

            <div className="flex min-h-[24rem] flex-1 flex-col pt-5">
              <Field error={formErrors?.body}>
                <PostBodyInput
                  value={draftBody}
                  onValueChange={(value) => {
                    bodyRef.current = value;
                    setDraftBody(value);
                  }}
                />
              </Field>
            </div>
            <AttachmentEditor
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
      </Form>
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

function AttachmentEditor({
  existing,
  additions,
  order,
  disabled,
  isDragging,
  onSelect,
  onRemoveExisting,
  onRemoveAddition,
  onMove,
}: {
  existing: PostAttachment[];
  additions: PreparedPostFile[];
  order: string[];
  disabled: boolean;
  isDragging: boolean;
  onSelect: (
    files: FileList | null,
    selection: "image" | "file",
  ) => Promise<void>;
  onRemoveExisting: (id: string) => void;
  onRemoveAddition: (key: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const existingById = new Map(
    existing.map((item) => [item.attachment_id, item]),
  );
  const additionsByKey = new Map(additions.map((item) => [item.key, item]));
  return (
    <section
      className={cn(
        "mt-6 rounded-xl border p-4",
        isDragging && "border-primary bg-primary/5",
      )}
      aria-label="첨부 파일"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">첨부 / 최대 10개</h2>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || existing.length + additions.length >= 10}
            onClick={() => photoInput.current?.click()}
          >
            <ImagePlusIcon /> 사진
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || existing.length + additions.length >= 10}
            onClick={() => fileInput.current?.click()}
          >
            <PaperclipIcon /> 파일
          </Button>
          <input
            ref={photoInput}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => {
              void onSelect(event.target.files, "image");
              event.target.value = "";
            }}
          />
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            multiple
            onChange={(event) => {
              void onSelect(event.target.files, "file");
              event.target.value = "";
            }}
          />
        </div>
      </div>
      {existing.length + additions.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {order.map((key, index) => {
            const existingItem = existingById.get(key);
            const addition = additionsByKey.get(key);
            if (!existingItem && !addition) return null;
            return (
              <AttachmentEditorItem
                key={key}
                name={existingItem?.original_filename ?? addition!.file.name}
                preview={
                  existingItem
                    ? existingItem.mime_type === "image/webp"
                      ? existingItem.signedUrl
                      : null
                    : addition!.previewUrl
                }
                index={index}
                count={order.length}
                onRemove={() =>
                  existingItem
                    ? onRemoveExisting(existingItem.attachment_id)
                    : onRemoveAddition(addition!.key)
                }
                onMove={(direction) => onMove(index, direction)}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function AttachmentEditorItem({
  name,
  preview,
  index,
  count,
  onRemove,
  onMove,
}: {
  name: string;
  preview: string | null;
  index: number;
  count: number;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-card p-2">
      {preview ? (
        <img src={preview} alt="" className="size-16 rounded-md object-cover" />
      ) : (
        <div className="flex size-16 items-center justify-center rounded-md bg-muted">
          <FileIcon />
        </div>
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      <div className="flex">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 위로 이동`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 아래로 이동`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 제거`}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
    </div>
  );
}

function Field({
  className,
  error,
  children,
}: {
  className?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
