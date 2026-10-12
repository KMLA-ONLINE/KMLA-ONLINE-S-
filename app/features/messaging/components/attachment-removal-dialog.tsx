import { FileIcon, ImageIcon, MusicIcon, Trash2Icon } from "lucide-react";

import { formatFileSize } from "~/features/messaging/model/attachments";
import type {
  ConversationMessage,
  MessageAttachment,
} from "~/features/messaging/model/types";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

const KIND_ICONS: Record<MessageAttachment["kind"], typeof FileIcon> = {
  image: ImageIcon,
  audio: MusicIcon,
  file: FileIcon,
};

/**
 * 보낸 메시지의 첨부를 하나씩 지운다(기능 명세 §13.5). 본문 없이 첨부만 있던 메시지에서 마지막
 * 첨부를 지우면 메시지도 지워진다.
 */
export function AttachmentRemovalDialog({
  message,
  onRemove,
  onClose,
}: {
  message: ConversationMessage;
  onRemove: (attachmentId: string) => void;
  onClose: () => void;
}) {
  const attachments = message.deleted ? [] : (message.attachments ?? []);
  const lastRemovesMessage = attachments.length === 1 && message.body === "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>첨부 지우기</DialogTitle>
          <DialogDescription>
            {lastRemovesMessage
              ? "마지막 첨부를 지우면 메시지도 지워집니다."
              : "지운 첨부는 모든 참여자에게서 사라집니다."}
          </DialogDescription>
        </DialogHeader>
        {attachments.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            남은 첨부가 없습니다.
          </p>
        ) : (
          <ul aria-label="첨부" className="flex flex-col gap-1">
            {attachments.map((attachment) => {
              const Icon = KIND_ICONS[attachment.kind];
              return (
                <li
                  key={attachment.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2"
                >
                  <Icon
                    aria-hidden
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {attachment.fileName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatFileSize(attachment.sizeBytes)}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full text-destructive"
                    aria-label={`${attachment.fileName} 지우기`}
                    onClick={() => {
                      onRemove(attachment.id);
                      if (attachments.length === 1) onClose();
                    }}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
