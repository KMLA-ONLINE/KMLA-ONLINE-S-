import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  FileIcon,
  GripVerticalIcon,
  ImagePlusIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { useRef, type ReactNode } from "react";

import { POST_ATTACHMENT_LIMIT } from "~/features/posts/model/constants";
import { formatFileSize } from "~/features/posts/model/format";
import type {
  PostAttachment,
  PostFileUploadState,
  PreparedPostFile,
} from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

export function PostAttachmentEditor({
  existing,
  additions,
  order,
  disabled,
  isDragging,
  uploadStates,
  onSelect,
  onRemoveExisting,
  onRemoveAddition,
  onMove,
  onRetry,
}: {
  existing: PostAttachment[];
  additions: PreparedPostFile[];
  order: string[];
  disabled: boolean;
  isDragging: boolean;
  uploadStates: Record<string, PostFileUploadState>;
  onSelect: (
    files: FileList | null,
    selection: "image" | "file",
  ) => Promise<void>;
  onRemoveExisting: (id: string) => void;
  onRemoveAddition: (key: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRetry: (key: string) => void;
}) {
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const existingById = new Map(
    existing.map((item) => [item.attachment_id, item]),
  );
  const additionsByKey = new Map(additions.map((item) => [item.key, item]));
  const totalSize =
    existing.reduce((total, item) => total + item.size_bytes, 0) +
    additions.reduce((total, item) => total + item.file.size, 0);
  const atLimit = order.length >= POST_ATTACHMENT_LIMIT;

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    let from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    while (from !== to) {
      const direction = from < to ? 1 : -1;
      onMove(from, direction);
      from += direction;
    }
  };

  return (
    <section
      className={cn(
        "mt-6 overflow-hidden rounded-2xl border bg-card",
        isDragging && "border-primary ring-4 ring-primary/10",
      )}
      aria-label="첨부 파일"
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 px-3 py-2 sm:border-b sm:px-4 sm:py-3",
          order.length > 0 && "border-b",
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium sm:text-base">첨부</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {order.length} / {POST_ATTACHMENT_LIMIT}
            </span>
          </div>
          {order.length > 0 ? (
            <p
              className="mt-0.5 hidden text-xs text-muted-foreground sm:block"
              aria-live="polite"
            >
              {formatFileSize(totalSize)}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="사진 추가"
            className="sm:w-auto sm:gap-1 sm:px-2.5"
            disabled={disabled || atLimit}
            onClick={() => photoInput.current?.click()}
          >
            <ImagePlusIcon />
            <span className="hidden sm:inline">사진 추가</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="파일 추가"
            className="sm:w-auto sm:gap-1 sm:px-2.5"
            disabled={disabled || atLimit}
            onClick={() => fileInput.current?.click()}
          >
            <PaperclipIcon />
            <span className="hidden sm:inline">파일 추가</span>
          </Button>
        </div>
        <input
          ref={photoInput}
          className="sr-only"
          type="file"
          name="postPhotos"
          aria-label="사진 선택"
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
          name="postFiles"
          aria-label="파일 선택"
          multiple
          onChange={(event) => {
            void onSelect(event.target.files, "file");
            event.target.value = "";
          }}
        />
      </div>

      {order.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {order.map((key, index) => {
                const existingItem = existingById.get(key);
                const addition = additionsByKey.get(key);
                if (!existingItem && !addition) return null;
                return (
                  <AttachmentEditorItem
                    key={key}
                    id={key}
                    name={
                      existingItem?.original_filename ?? addition!.file.name
                    }
                    size={existingItem?.size_bytes ?? addition!.file.size}
                    preview={
                      existingItem
                        ? existingItem.mime_type === "image/webp"
                          ? existingItem.signedUrl
                          : null
                        : addition!.previewUrl
                    }
                    state={addition ? uploadStates[key] : undefined}
                    index={index}
                    count={order.length}
                    disabled={disabled}
                    onRemove={() =>
                      existingItem
                        ? onRemoveExisting(existingItem.attachment_id)
                        : onRemoveAddition(addition!.key)
                    }
                    onMove={(direction) => onMove(index, direction)}
                    onRetry={addition ? () => onRetry(addition.key) : undefined}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
          className="group hidden min-h-32 w-full flex-col items-center justify-center gap-2 px-4 py-6 text-center hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 sm:flex"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover:text-foreground">
            <UploadCloudIcon aria-hidden="true" />
          </span>
          <span className="text-sm font-medium">
            사진이나 파일을 끌어 놓으세요
          </span>
          <span className="text-xs text-muted-foreground">
            파일당 최대 30MB
          </span>
        </button>
      )}
    </section>
  );
}

function AttachmentEditorItem({
  id,
  name,
  size,
  preview,
  state,
  index,
  count,
  disabled,
  onRemove,
  onMove,
  onRetry,
}: {
  id: string;
  name: string;
  size: number;
  preview: string | null;
  state?: PostFileUploadState;
  index: number;
  count: number;
  disabled: boolean;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onRetry?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  const status = state?.status;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative flex min-w-0 items-center gap-3 rounded-xl border bg-background p-2 shadow-xs",
        isDragging && "z-10 opacity-70 shadow-lg",
        status === "error" && "border-destructive/50",
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={`${name} 순서 변경`}
        className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon />
      </Button>
      {preview ? (
        <img
          src={preview}
          alt=""
          width={48}
          height={48}
          className="size-12 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileIcon aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={name}>
          {name}
        </p>
        <p className="text-xs text-muted-foreground">
          {status === "queued"
            ? "업로드 대기 중"
            : status === "uploading"
              ? `업로드 중 ${Math.round((state?.progress ?? 0) * 100)}%`
              : status === "error"
                ? "업로드 실패"
                : status === "ready"
                  ? "업로드 완료"
                  : formatFileSize(size)}
        </p>
        {status === "uploading" ? (
          <progress
            value={state?.progress ?? 0}
            max={1}
            aria-label={`${name} 업로드 진행률`}
            className="mt-1 h-1 w-full accent-primary"
          />
        ) : null}
      </div>
      {status === "error" && onRetry ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 업로드 다시 시도`}
          onClick={onRetry}
        >
          <RefreshCwIcon />
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`${name} 첨부 메뉴`}
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={index === 0} onClick={() => onMove(-1)}>
              앞으로 이동
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              뒤로 이동
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2Icon /> 제거
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PostFormField({
  className,
  error,
  children,
}: {
  className?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
