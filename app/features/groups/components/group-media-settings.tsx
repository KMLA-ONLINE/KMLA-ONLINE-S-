import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useRevalidator } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import {
  removeGroupMedia,
  replaceGroupMedia,
} from "~/features/groups/data/mutations";
import { groupKeys } from "~/features/groups/data/cache";
import type {
  GroupDetail,
  GroupMediaSlot,
} from "~/features/groups/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { ImageCropper } from "~/shared/components/image-cropper";
import { useImageCrop } from "~/shared/hooks/use-image-crop";
import {
  compressImage,
  getImageDimensions,
  IMAGE_INPUT_ACCEPT,
  isSupportedImageInput,
  prepareImageInput,
} from "~/shared/lib/image/compress";
import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";
import { getQueryClient } from "~/shared/lib/query-client";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Spinner } from "~/shared/ui/spinner";

export function GroupMediaSettings({ group }: { group: GroupDetail }) {
  const t = useT();
  return (
    <Card className="rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader className="border-b">
        <CardTitle>{t("그룹 프로필")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="relative aspect-[4/1] w-full overflow-hidden bg-gradient-to-br from-primary/25 via-primary/10 to-muted">
            {group.cover_path ? (
              <img
                src={group.cover_path}
                alt={t("현재 그룹 커버")}
                crossOrigin="anonymous"
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
              className="-mt-7 size-16 translate-y-2 rounded-xl text-xl"
            />
            <div className="min-w-0 flex-1 pb-2">
              <p className="truncate font-semibold">{group.name}</p>
              <p className="text-xs text-muted-foreground">
                {t("멤버 {count}명", { count: group.member_count })}
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
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const revalidator = useRevalidator();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const isIcon = slot === "icon";
  const currentPath = isIcon ? group.icon_path : group.cover_path;
  const slotLabel = isIcon ? t("그룹 아이콘") : t("커버 이미지");

  const upload = async (cropped: File) => {
    setPending(true);
    setError(null);
    try {
      const file = await compressImage(cropped, isIcon ? "icon" : "banner");
      const [width, height] = await getImageDimensions(file);
      await replaceGroupMedia(group.group_id, slot, file, { width, height });
      await getQueryClient().invalidateQueries({
        queryKey: groupKeys.all,
        refetchType: "none",
      });
      await revalidator.revalidate();
    } catch {
      setError(t("이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const crop = useImageCrop((file) => void upload(file));

  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedImageInput(file) || file.size > MAX_INPUT_FILE_BYTES) {
      setError(
        t("JPEG, PNG, WebP, HEIC, HEIF 이미지를 30MB 이하로 선택해 주세요."),
      );
      return;
    }
    setError(null);
    try {
      crop.start(await prepareImageInput(file));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("이미지를 처리하지 못했습니다."),
      );
    }
  };

  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await removeGroupMedia(group.group_id, slot);
      await getQueryClient().invalidateQueries({
        queryKey: groupKeys.all,
        refetchType: "none",
      });
      await revalidator.revalidate();
    } catch {
      setError(t("이미지를 제거하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">{slotLabel}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isIcon
            ? t("정사각형 · 최대 512px")
            : t("4:1 가로형 · 긴 변 최대 2400px")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_INPUT_ACCEPT}
          className="sr-only"
          onChange={(event) => void selectFile(event.target.files?.[0])}
          aria-label={t("{slot} 파일 선택", { slot: slotLabel })}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={
            currentPath
              ? t("{slot} 변경", { slot: slotLabel })
              : t("{slot} 등록", { slot: slotLabel })
          }
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadIcon aria-hidden="true" />
          )}
          {currentPath ? t("변경") : t("등록")}
        </Button>
        {currentPath ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("{slot} 제거", { slot: slotLabel })}
            disabled={pending}
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2Icon aria-hidden="true" /> {t("제거")}
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
          title={isIcon ? t("그룹 아이콘 편집") : t("그룹 커버 편집")}
        />
      ) : null}
      {removeOpen ? (
        <ConfirmDialog
          title={t("{slot} 삭제", { slot: slotLabel })}
          description={
            isIcon
              ? t("현재 그룹 아이콘을 삭제할까요?")
              : t("현재 커버 이미지를 삭제할까요?")
          }
          confirmLabel={t("삭제")}
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
