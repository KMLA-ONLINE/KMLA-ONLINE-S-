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

      await replaceProfileMedia(profile, slot, compressed);

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
      await removeProfileMedia(profile, slot);
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

        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={pending}
          aria-label={isAvatar ? "프로필 사진 변경" : "커버 사진 변경"}
          onClick={handleEditorClick}
          className="rounded-full bg-background shadow-sm ring-2 ring-background"
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
