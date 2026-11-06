import { useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import {
  removeConversationImage,
  replaceConversationImage,
} from "~/features/messaging/data/files";
import { invalidateConversationList } from "~/features/messaging/data/cache";
import { refreshConversationInList } from "~/features/messaging/data/sync";
import type { ConversationSummary } from "~/features/messaging/model/types";
import { ImageCropper } from "~/shared/components/image-cropper";
import { useImageCrop } from "~/shared/hooks/use-image-crop";
import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";
import {
  compressImage,
  getImageDimensions,
  IMAGE_INPUT_ACCEPT,
  isSupportedImageInput,
  prepareImageInput,
} from "~/shared/lib/image/compress";
import { isNetworkError } from "~/shared/lib/network-error";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 대화 정보의 그룹 사진(기능 명세 §13.29). 바꿀 수 있는 멤버에게는 아바타가 버튼이 되어 사진을 고르고
 * 정사각형으로 잘라 올리며, 사진이 있으면 변경·지우기 중에서 고른다. 저장 뒤에는 대화 목록의 그 대화
 * 한 줄을 다시 읽어 목록·대화방·대화 정보·메시지 독이 함께 바뀐다.
 */
export function ConversationImageEditor({
  conversation,
  editable,
  className,
}: {
  conversation: Pick<
    ConversationSummary,
    "id" | "type" | "name" | "participants" | "viewerId" | "imageUrl"
  >;
  /** 지금 멤버인 그룹 대화에서만 참이다. */
  editable: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  const refresh = () =>
    refreshConversationInList(queryClient, conversation.id).catch(
      () => void invalidateConversationList(queryClient),
    );

  const openPicker = () => {
    setActionsOpen(false);
    requestAnimationFrame(() => inputRef.current?.click());
  };

  const upload = async (cropped: File) => {
    setPending(true);
    try {
      const compressed = await compressImage(cropped, "icon");
      const [width, height] = await getImageDimensions(compressed);
      await replaceConversationImage(conversation.id, compressed, {
        width,
        height,
      });
      await refresh();
    } catch (cause) {
      console.error("Failed to save the conversation image", cause);
      toast.error(
        isNetworkError(cause)
          ? "인터넷 연결을 확인한 뒤 다시 시도해 주세요."
          : "그룹 사진을 저장하지 못했습니다.",
      );
    } finally {
      setPending(false);
      setActionsOpen(false);
    }
  };

  const remove = async () => {
    setPending(true);
    try {
      await removeConversationImage(conversation.id);
      await refresh();
    } catch (cause) {
      console.error("Failed to remove the conversation image", cause);
      toast.error("그룹 사진을 지우지 못했습니다.");
    } finally {
      setPending(false);
      setActionsOpen(false);
    }
  };

  const crop = useImageCrop((file) => {
    void upload(file);
  });

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedImageInput(file) || file.size > MAX_INPUT_FILE_BYTES) {
      toast.error(
        "JPEG, PNG, WebP, HEIC, HEIF 이미지를 30MB 이하로 선택해 주세요.",
      );
      return;
    }
    try {
      crop.start(await prepareImageInput(file));
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "이미지를 처리하지 못했습니다.",
      );
    }
  };

  if (!editable) {
    return (
      <ConversationAvatar
        conversation={conversation}
        size="lg"
        className={className}
      />
    );
  }

  return (
    <>
      <div className={cn("relative", className)}>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_INPUT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            void chooseFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <ConversationAvatar conversation={conversation} size="lg" />
        <button
          type="button"
          disabled={pending}
          aria-label="그룹 사진 변경"
          onClick={() =>
            conversation.imageUrl ? setActionsOpen(true) : openPicker()
          }
          className={cn(
            "absolute inset-0 grid place-items-center rounded-full text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            pending
              ? "bg-black/40"
              : "cursor-pointer bg-black/0 hover:bg-black/25 [&>svg]:opacity-0 hover:[&>svg]:opacity-100",
          )}
        >
          {pending ? (
            <Spinner className="size-6 text-white" />
          ) : (
            <ImageIcon aria-hidden className="size-6 transition-opacity" />
          )}
        </button>
      </div>

      <Dialog
        open={actionsOpen}
        onOpenChange={(open) => {
          if (!pending) setActionsOpen(open);
        }}
      >
        <DialogContent
          className="gap-0 p-1.5 sm:max-w-xs"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">그룹 사진</DialogTitle>
          <div className="flex flex-col">
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full justify-start gap-3 px-3"
              disabled={pending}
              onClick={openPicker}
            >
              <ImageIcon />
              사진 변경
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full justify-start gap-3 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={pending}
              onClick={() => void remove()}
            >
              {pending ? <Spinner data-icon="inline-start" /> : <Trash2Icon />}
              사진 지우기
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {crop.cropperProps ? (
        <ImageCropper
          {...crop.cropperProps}
          aspect={1}
          maxOutputEdge={512}
          round
          title="그룹 사진"
        />
      ) : null}
    </>
  );
}
