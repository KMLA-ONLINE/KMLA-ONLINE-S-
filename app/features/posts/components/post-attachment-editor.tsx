import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileIcon,
  ImagePlusIcon,
  PaperclipIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef, type ReactNode } from "react";

import type {
  PostAttachment,
  PreparedPostFile,
} from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

export function PostAttachmentEditor({
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
