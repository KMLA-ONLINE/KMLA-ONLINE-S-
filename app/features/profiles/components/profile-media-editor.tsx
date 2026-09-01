import { ImageIcon, RotateCcwIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
  removeProfileMedia,
  replaceProfileMedia,
} from "~/features/profiles/data/media";
import type {
  AcceptedProfile,
  ProfileMediaSlot,
} from "~/features/profiles/model/types";
import { ImageCropper } from "~/shared/components/image-cropper";
import { useImageCrop } from "~/shared/hooks/use-image-crop";
import { compressImage } from "~/shared/lib/image/compress";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ProfileMediaEditor({
  profile,
  slot,
  className,
}: {
  profile: AcceptedProfile;
  slot: ProfileMediaSlot;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAvatar = slot === "avatar";

  const hasCurrentMedia = Boolean(
    isAvatar ? profile.avatar_path : profile.cover_path,
  );

  const openPicker = () => {
    setActionsOpen(false);

    requestAnimationFrame(() => {
      inputRef.current?.click();
    });
  };

  const upload = async (cropped: File) => {
    setPending(true);
    setError(null);

    try {
      const compressed = await compressImage(
        cropped,
        isAvatar ? "icon" : "banner",
      );
      const bitmap = await createImageBitmap(compressed);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();

      await replaceProfileMedia(slot, compressed, dimensions);

      window.location.reload();
    } catch {
      setPending(false);
      setError("이미지를 저장하지 못했습니다.");
    }
  };

  const reset = async () => {
    setPending(true);
    setError(null);

    try {
      await removeProfileMedia(slot);
      window.location.reload();
    } catch {
      setPending(false);
      setActionsOpen(false);
      setError("기본 이미지로 변경하지 못했습니다.");
    }
  };

  const crop = useImageCrop((file) => {
    void upload(file);
  });

  const chooseFile = (file: File | undefined) => {
    if (!file) return;

    if (!ACCEPTED_TYPES.has(file.type) || file.size > 30 * 1024 * 1024) {
      setError("JPEG, PNG, WebP 이미지만 사용할 수 있습니다.");
      return;
    }

    setError(null);
    crop.start(file);
  };

  const handleEditorClick = () => {
    setError(null);

    if (hasCurrentMedia) {
      setActionsOpen(true);
      return;
    }

    inputRef.current?.click();
  };

  return (
    <>
      <div className={cn("relative", className)}>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            chooseFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />

        {/* 데스크톱에서는 아바타 자체가 버튼이다. 배지를 숨긴 대신 hover 시 살짝 어두워지는
            것으로 누를 수 있다는 걸 알린다. 터치에는 hover가 없어 이 힌트가 통하지 않으므로
            모바일은 배지를 그대로 둔다 — 두 트리거는 `sm:`을 사이에 두고 한 번에 하나만
            렌더되므로 같은 `aria-label`이 겹쳐 노출되지 않는다. */}
        {isAvatar ? (
          <button
            type="button"
            disabled={pending}
            aria-label="프로필 사진 변경"
            onClick={handleEditorClick}
            className={cn(
              "pointer-events-auto absolute inset-0 hidden place-items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grid",
              pending
                ? "bg-black/40"
                : "cursor-pointer bg-black/0 hover:bg-black/25",
            )}
          >
            {pending ? <Spinner className="size-6 text-white" /> : null}
          </button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={pending}
          aria-label={isAvatar ? "프로필 사진 변경" : "커버 사진 변경"}
          onClick={handleEditorClick}
          className={cn(
            "pointer-events-auto rounded-full bg-background shadow-sm ring-2 ring-background",
            // 아바타 배지는 이제 `inset-0`인 root 안에서 스스로 자리를 잡는다.
            isAvatar && "absolute right-0 bottom-0 sm:hidden",
          )}
        >
          {pending ? <Spinner /> : <ImageIcon aria-hidden="true" />}
        </Button>

        {error ? (
          <p
            role="alert"
            className="absolute top-full right-0 z-30 mt-2 w-56 rounded-md border bg-background p-2 text-xs text-destructive shadow-md"
          >
            {error}
          </p>
        ) : null}
      </div>

      <Dialog
        open={actionsOpen}
        onOpenChange={(open) => {
          if (!pending) setActionsOpen(open);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isAvatar ? "프로필 사진" : "커버 사진"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-2">
            <Button
              type="button"
              className="w-full justify-start"
              disabled={pending}
              onClick={openPicker}
            >
              <ImageIcon />
              사진 변경
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              disabled={pending}
              onClick={() => {
                void reset();
              }}
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCcwIcon />
              )}
              기본 이미지로 변경
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {crop.cropperProps ? (
        <ImageCropper
          {...crop.cropperProps}
          aspect={isAvatar ? 1 : 3}
          maxOutputEdge={isAvatar ? 512 : 2400}
          round={isAvatar}
          title={isAvatar ? "프로필 사진" : "커버 사진"}
        />
      ) : null}
    </>
  );
}
