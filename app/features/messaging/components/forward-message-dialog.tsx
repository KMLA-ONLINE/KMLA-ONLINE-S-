import { attachmentKindLabel } from "~/features/messaging/model/attachments";
import { useId, useState } from "react";

import { SendToChatsDialog } from "~/features/messaging/components/send-to-chats-dialog";
import { messagePlainText } from "~/features/messaging/model/message-mentions";
import type { ConversationMessage } from "~/features/messaging/model/types";
import { Checkbox } from "~/shared/ui/checkbox";

/**
 * 메시지 전달. 글과 첨부를 다른 대화에 내가 새로 보내는 메시지로 보낸다. 첨부는
 * Storage 안에서 복사하므로 기기에 내려받지 않는다. 글과 첨부가 함께 있으면 무엇을 보낼지 고른다.
 * 부모는 열 때마다 `key`를 바꿔 고른 것을 처음(둘 다 보냄)으로 되돌린다.
 */
export function ForwardMessageDialog({
  open,
  onOpenChange,
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: ConversationMessage | null;
}) {
  const text = message ? messagePlainText(message) : "";
  const attachments = (message?.attachments ?? []).filter(
    ({ expired }) => !expired,
  );
  const hasText = text !== "";
  const hasAttachments = attachments.length > 0;
  const id = useId();
  const [includeText, setIncludeText] = useState(true);
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const sendsText = hasText && includeText;
  const sendsAttachments = hasAttachments && includeAttachments;
  const imageCount = attachments.filter(({ kind }) => kind === "image").length;
  const attachmentLabel =
    imageCount === attachments.length
      ? `사진 ${imageCount}장`
      : attachments[0]
        ? attachmentKindLabel(attachments[0].kind)
        : "파일";

  return (
    <SendToChatsDialog
      open={open}
      onOpenChange={onOpenChange}
      subject="메시지"
      empty={!sendsText && !sendsAttachments}
      contentKey={`${sendsText}:${sendsAttachments}`}
      content={() =>
        sendsText || sendsAttachments
          ? {
              body: sendsText ? text : "",
              attachments: sendsAttachments ? attachments : [],
            }
          : null
      }
      options={
        hasText && hasAttachments ? (
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <legend className="sr-only">보낼 내용</legend>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-text`}
                checked={includeText}
                onCheckedChange={(checked) => setIncludeText(checked)}
              />
              <label htmlFor={`${id}-text`}>글</label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-attachments`}
                checked={includeAttachments}
                onCheckedChange={(checked) => setIncludeAttachments(checked)}
              />
              <label htmlFor={`${id}-attachments`}>{attachmentLabel}</label>
            </div>
          </fieldset>
        ) : null
      }
    />
  );
}
