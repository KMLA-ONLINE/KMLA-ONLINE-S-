import { useQueryClient } from "@tanstack/react-query";
import { MessageCircleIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { invalidateConversationList } from "~/features/messaging/data/cache";
import { openDirectConversation } from "~/features/messaging/data/mutations";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 다른 사람 프로필의 `메시지 보내기`(기능 명세 §13.1). 그 사람과의 1:1 대화가 있으면 그 방으로, 없으면
 * 새로 만들어 그 방으로 간다. 같은 두 사람 사이의 방은 서버가 하나만 둔다.
 */
export function SendMessageButton({
  profileId,
  className,
}: {
  profileId: number;
  className?: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);

  async function open() {
    setOpening(true);
    try {
      const conversationId = await openDirectConversation(String(profileId));
      void invalidateConversationList(queryClient);
      await navigate(`/messenger/${conversationId}`);
    } catch {
      toast.error(t("채팅을 열지 못했습니다."));
      setOpening(false);
    }
  }

  return (
    <Button
      type="button"
      variant="default"
      size="sm"
      className={className}
      disabled={opening}
      onClick={() => void open()}
    >
      {opening ? <Spinner data-icon="inline-start" /> : <MessageCircleIcon />}
      {t("메시지 보내기")}
    </Button>
  );
}
