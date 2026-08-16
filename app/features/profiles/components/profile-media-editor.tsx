import { ImageIcon } from "lucide-react";
import { useRef, useState } from "react";

import { replaceProfileMedia } from "~/features/profiles/data/media";
import type {
  AcceptedProfile,
  ProfileMediaSlot,
} from "~/features/profiles/model/types";
import { ImageCropper } from "~/shared/components/image-cropper";
import { useImageCrop } from "~/shared/hooks/use-image-crop";
import { compressImage } from "~/shared/lib/image/compress";
import { Button } from "~/shared/ui/button";
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
  const [error, setError] = useState<string | null>(null);

  const isAvatar = slot === "avatar";

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

  return (
    <>
      <div className={className}>
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
          size={isAvatar ? "icon-sm" : "sm"}
          disabled={pending}
          aria-label={isAvatar ? "프로필 사진 변경" : "커버 사진 변경"}
          onClick={() => inputRef.current?.click()}
          className={
            isAvatar
              ? "rounded-full shadow-sm ring-2 ring-background"
              : "shadow-sm"
          }
        >
          {pending ? <Spinner /> : <ImageIcon aria-hidden="true" />}

          {isAvatar ? null : <span className="max-sm:sr-only">커버 사진</span>}
        </Button>

        {error ? (
          <p
            role="alert"
            className="absolute top-full right-0 mt-2 w-56 rounded-md border bg-background p-2 text-xs text-destructive shadow-md"
          >
            {error}
          </p>
        ) : null}
      </div>

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
