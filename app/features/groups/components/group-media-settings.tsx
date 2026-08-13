import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useRevalidator } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import {
  removeGroupMedia,
  replaceGroupMedia,
} from "~/features/groups/data/mutations";
import type {
  GroupDetail,
  GroupMediaSlot,
} from "~/features/groups/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { ImageCropper } from "~/shared/components/image-cropper";
import { useImageCrop } from "~/shared/hooks/use-image-crop";
import { compressImage } from "~/shared/lib/image/compress";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Spinner } from "~/shared/ui/spinner";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function GroupMediaSettings({ group }: { group: GroupDetail }) {
  return (
    <Card className="rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader className="border-b">
        <CardTitle>그룹 프로필</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="overflow-hidden rounded-xl border bg-muted/40">
          <div className="relative aspect-[4/1] w-full overflow-hidden bg-gradient-to-br from-primary/25 via-primary/10 to-muted">
            {group.cover_path ? (
              <img
                src={group.cover_path}
                alt="현재 그룹 커버"
                width={1200}
                height={300}
                className="size-full object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center">
                <ImageIcon
                  aria-hidden="true"
                  className="size-7 text-muted-foreground/50"
                />
              </div>
            )}
          </div>
          <div className="flex min-h-20 items-end gap-3 px-4 pb-4">
            <GroupAvatar
              name={group.name}
              iconPath={group.icon_path}
              className="-mt-7 size-16 rounded-xl border-4 border-card bg-card text-xl shadow-sm"
            />
            <div className="min-w-0 flex-1 pb-0.5">
              <p className="truncate font-semibold">{group.name}</p>
              <p className="text-xs text-muted-foreground">
                멤버 {group.member_count.toLocaleString("ko-KR")}명
              </p>
            </div>
          </div>
        </div>

        <div className="divide-y rounded-xl border">
          <MediaField group={group} slot="icon" />
          <MediaField group={group} slot="cover" />
        </div>
      </CardContent>
    </Card>
  );
}

function MediaField({
  group,
  slot,
}: {
  group: GroupDetail;
  slot: GroupMediaSlot;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const revalidator = useRevalidator();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const isIcon = slot === "icon";
  const currentPath = isIcon ? group.icon_path : group.cover_path;

  const upload = async (cropped: File) => {
    setPending(true);
    setError(null);
    try {
      const file = await compressImage(cropped, isIcon ? "icon" : "banner");
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      await replaceGroupMedia(group.group_id, slot, file, dimensions);
      await revalidator.revalidate();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "이미지를 저장하지 못했습니다.",
      );
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const crop = useImageCrop((file) => void upload(file));

  const selectFile = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type) || file.size > 30 * 1024 * 1024) {
      setError("JPEG, PNG, WebP 이미지를 30MiB 이하로 선택해 주세요.");
      return;
    }
    setError(null);
    crop.start(file);
  };

  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await removeGroupMedia(group.group_id, slot);
      await revalidator.revalidate();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "이미지를 제거하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">
          {isIcon ? "그룹 아이콘" : "커버 이미지"}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isIcon ? "정사각형 · 최대 512px" : "4:1 가로형 · 긴 변 최대 2400px"}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => selectFile(event.target.files?.[0])}
          aria-label={`${isIcon ? "그룹 아이콘" : "커버 이미지"} 파일 선택`}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${isIcon ? "그룹 아이콘" : "커버 이미지"} ${currentPath ? "변경" : "등록"}`}
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadIcon aria-hidden="true" />
          )}
          {currentPath ? "변경" : "등록"}
        </Button>
        {currentPath ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`${isIcon ? "그룹 아이콘" : "커버 이미지"} 제거`}
            disabled={pending}
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2Icon aria-hidden="true" /> 제거
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive sm:basis-full">
          {error}
        </p>
      ) : null}
      {crop.cropperProps ? (
        <ImageCropper
          {...crop.cropperProps}
          aspect={isIcon ? 1 : 4}
          maxOutputEdge={isIcon ? 512 : 2400}
          round={false}
          title={isIcon ? "그룹 아이콘 편집" : "그룹 커버 편집"}
        />
      ) : null}
      {removeOpen ? (
        <ConfirmDialog
          title={`${isIcon ? "그룹 아이콘" : "커버 이미지"} 삭제`}
          description={`현재 ${isIcon ? "그룹 아이콘" : "커버 이미지"}을 삭제할까요?`}
          confirmLabel="삭제"
          destructive
          pending={pending}
          onCancel={() => setRemoveOpen(false)}
          onConfirm={() => {
            setRemoveOpen(false);
            void remove();
          }}
        />
      ) : null}
    </section>
  );
}
