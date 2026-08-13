import {
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FileIcon,
  ImagePlusIcon,
  MoreHorizontalIcon,
  PinIcon,
  PaperclipIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigate, useNavigation } from "react-router";

import {
  createGroupPostWithAttachments,
  createPostUploadSession,
  updateGroupPostWithAttachments,
} from "~/features/posts/data/mutations";
import {
  preparePostFiles,
  releasePostFile,
} from "~/features/posts/model/attachments";
import { formatPostDate } from "~/features/posts/model/format";
import { PostBodyInput } from "~/features/posts/components/post-body-input";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import type {
  GroupCategory,
  GroupPostDetail,
  PostFormErrors,
  PostFormValues,
  PostIdentity,
  PostAttachment,
  PostSaveProgress,
  PreparedPostFile,
} from "~/features/posts/model/types";
import {
  hasPostFormErrors,
  validatePostForm,
} from "~/features/posts/model/validation";
import { useFileDrop } from "~/shared/hooks/use-file-drop";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";

export function GroupPostOverlay({
  mode,
  slug,
  groupName,
  groupId,
  categories,
  post,
  values,
  errors,
  identities = ["identified"],
}: {
  mode: "create" | "detail" | "edit";
  slug: string;
  groupName: string;
  groupId: string;
  categories: GroupCategory[];
  post?: GroupPostDetail | null;
  values?: PostFormValues;
  errors?: PostFormErrors;
  identities?: PostIdentity[];
}) {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pending = navigation.state === "submitting";
  const close = () => void navigate(`/groups/${slug}`);

  if (mode !== "detail") {
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
          pending={pending}
          onClose={close}
        />
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="inset-0 top-0 left-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        showCloseButton
      >
        {post ? (
          <PostDetail
            slug={slug}
            groupName={groupName}
            post={post}
            attachments={post.attachments}
            onDelete={() => setDeleteOpen(true)}
          />
        ) : null}
      </DialogContent>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>게시물 삭제</DialogTitle>
            <DialogDescription>
              삭제한 게시물은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              취소
            </Button>
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? <Spinner /> : null} 삭제
              </Button>
            </Form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
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
  pending: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const initial = values ?? {
    title: post?.title ?? "",
    body: post?.body ?? "",
    categoryId: post?.category_id ?? "",
    authorIdentity: post?.author_identity ?? identities[0],
  };
  const [formErrors, setFormErrors] = useState(errors);
  const [existing, setExisting] = useState(post?.attachments ?? []);
  const [removedIds, setRemovedIds] = useState(new Set<string>());
  const [additions, setAdditions] = useState<PreparedPostFile[]>([]);
  const [attachmentOrder, setAttachmentOrder] = useState(
    () => post?.attachments.map((item) => item.attachment_id) ?? [],
  );
  const additionsRef = useRef(additions);
  additionsRef.current = additions;
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<PostSaveProgress | null>(null);
  const session = useRef(createPostUploadSession());
  const totalCount = existing.length + additions.length;

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

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const nextValues: PostFormValues = {
      title: text("title").trim(),
      body: text("body").trim(),
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
      void navigate(`/groups/${slug}/posts/${postId}`);
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
    <Form
      method="post"
      onSubmit={(event) => void submit(event)}
      className="flex min-h-0 flex-1 flex-col"
      {...dropHandlers}
    >
      <input type="hidden" name="intent" value={mode} />
      <header className="shrink-0 border-b bg-background pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-3 sm:px-6">
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

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-5 sm:px-6 sm:py-8">
          <div className="grid gap-4 border-b pb-5 sm:grid-cols-[minmax(0,1fr)_12rem_10rem]">
            <Field label="제목" error={formErrors?.title}>
              <Input
                name="title"
                defaultValue={initial.title}
                maxLength={100}
                required
                className="h-11 text-base font-medium"
              />
            </Field>
            <Field label="카테고리" error={formErrors?.categoryId}>
              <NativeSelect
                name="categoryId"
                defaultValue={initial.categoryId}
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
            {mode === "create" ? (
              <Field label="작성 신원" error={formErrors?.authorIdentity}>
                <NativeSelect
                  name="authorIdentity"
                  defaultValue={initial.authorIdentity}
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

          <div className="flex min-h-[24rem] flex-1 flex-col pt-5">
            <Field label="본문" error={formErrors?.body}>
              <PostBodyInput initialValue={initial.body} />
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
          <h2 className="font-medium">첨부</h2>
          <p className="text-xs text-muted-foreground">
            최대 10개, 데스크톱에서는 끌어놓을 수 있습니다.
          </p>
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

function PostDetail({
  slug,
  groupName,
  post,
  attachments,
  onDelete,
}: {
  slug: string;
  groupName: string;
  post: GroupPostDetail;
  attachments: PostAttachment[];
  onDelete: () => void;
}) {
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: post.title, url });
    else await navigator.clipboard.writeText(url);
  };
  return (
    <article className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="border-b p-5 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>{post.title}</DialogTitle>
            <DialogDescription className="mt-2">
              {groupName} · {post.category_name || "미분류"}
            </DialogDescription>
          </div>
          {post.can_edit || post.can_delete || post.can_pin ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="게시물 메뉴"
                  />
                }
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {post.can_edit ? (
                  <DropdownMenuItem
                    render={
                      <Link to={`/groups/${slug}/posts/${post.post_id}/edit`} />
                    }
                  >
                    수정
                  </DropdownMenuItem>
                ) : null}
                {post.can_pin ? (
                  <DropdownMenuItem render={<Form method="post" />}>
                    <input type="hidden" name="intent" value="pin" />
                    <input
                      type="hidden"
                      name="pinned"
                      value={String(!post.is_pinned)}
                    />
                    <button type="submit" className="contents">
                      {post.is_pinned ? "고정 해제" : "고정"}
                    </button>
                  </DropdownMenuItem>
                ) : null}
                {post.can_delete ? (
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    삭제
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </DialogHeader>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {post.is_pinned ? (
            <>
              <PinIcon className="size-4" /> 고정됨 ·
            </>
          ) : null}
          <span>{post.author_name || post.author_label}</span>
          <time dateTime={post.published_at}>
            {formatPostDate(post.published_at)}
          </time>
          {post.edited_at ? <span>수정됨</span> : null}
        </div>
        <PostMarkdown className="mt-8">{post.body}</PostMarkdown>
        <PostAttachments attachments={attachments} />
      </div>
      <div className="border-t p-4">
        <Button variant="outline" onClick={() => void share()}>
          <Share2Icon /> 공유
        </Button>
      </div>
    </article>
  );
}

export function PostAttachments({
  attachments,
  compact = false,
}: {
  attachments: PostAttachment[];
  compact?: boolean;
}) {
  const images = attachments.filter((item) => item.mime_type === "image/webp");
  const files = attachments.filter((item) => item.mime_type !== "image/webp");
  if (!attachments.length) return null;
  return (
    <div className="mt-6 space-y-3">
      {images.length ? (
        <div
          className={cn(
            "grid gap-2 overflow-hidden rounded-xl",
            images.length > 1 && "grid-cols-2",
          )}
        >
          {images.slice(0, compact ? 4 : images.length).map((item) =>
            item.signedUrl ? (
              <img
                key={item.attachment_id}
                src={item.signedUrl}
                alt={item.original_filename}
                className={cn(
                  "w-full object-cover",
                  compact ? "h-36" : "max-h-[32rem]",
                )}
                loading="lazy"
              />
            ) : (
              <div
                key={item.attachment_id}
                className="flex h-32 items-center justify-center bg-muted text-sm text-muted-foreground"
              >
                이미지를 불러오지 못했습니다.
              </div>
            ),
          )}
        </div>
      ) : null}
      {files.map((item) =>
        item.signedUrl ? (
          <a
            key={item.attachment_id}
            href={item.signedUrl}
            download={item.original_filename}
            className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-muted"
          >
            <FileIcon />{" "}
            <span className="truncate">{item.original_filename}</span>
          </a>
        ) : (
          <div
            key={item.attachment_id}
            className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground"
          >
            <FileIcon /> {item.original_filename} (다운로드할 수 없음)
          </div>
        ),
      )}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
