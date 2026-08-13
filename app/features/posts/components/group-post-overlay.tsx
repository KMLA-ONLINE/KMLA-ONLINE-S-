import {
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FileIcon,
  ImagePlusIcon,
  PaperclipIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Form, useNavigate, useNavigation } from "react-router";

import {
  createGroupPostWithAttachments,
  createPostUploadSession,
  updateGroupPostWithAttachments,
} from "~/features/posts/data/mutations";
import {
  preparePostFiles,
  releasePostFile,
} from "~/features/posts/model/attachments";
import { PostBodyInput } from "~/features/posts/components/post-body-input";
import { PostDetail } from "~/features/posts/components/post-detail";
import type {
  GroupCategory,
  GroupPostDetail,
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
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
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
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  // 그룹으로 `navigate`하면 히스토리에 작성 화면이 남아서, 뒤로 가기를 누른 사용자가 방금
  // 버린 초안을 다시 마주하게 된다. 들어온 경로를 되감는 게 맞다.
  const close = useModalClose(`/groups/${slug}`);

  if (mode === "detail") {
    return post ? <PostDetail post={post} slug={slug} /> : null;
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
      // `replace`가 핵심이다. push하면 히스토리가 `그룹 → 작성 → 상세`가 되고, 상세 모달을
      // 닫을 때(뒤로 가기) 방금 떠난 작성 화면이 다시 열린다. 저장이 끝난 작성·수정 화면은
      // 돌아갈 곳이 아니므로 그 자리를 상세로 갈아끼운다.
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
      <header className="shrink-0 border-b bg-background pt-[env(safe-area-inset-top)] md:border-b-0 md:bg-muted/40">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-3 sm:px-6 md:border-x md:border-b md:bg-background">
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

      <main className="min-h-0 flex-1 overflow-y-auto md:bg-muted/40">
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
