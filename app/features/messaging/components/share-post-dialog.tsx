import { LinkIcon, ShareIcon } from "lucide-react";
import { toast } from "sonner";

import { SendToChatsDialog } from "~/features/messaging/components/send-to-chats-dialog";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";

/** 운영체제 공유 시트를 여는 기기. 폰·태블릿은 다른 앱으로 바로 이어지고, 데스크톱은 링크 복사가 더 빠르다. */
const NATIVE_SHARE_QUERY = "(hover: none) and (pointer: coarse)";

/**
 * 게시물 보내기(기능 명세 §8.13). 고른 대화마다 게시물 링크 하나만 보낸다. 받는 쪽은 그 링크를 게시물
 * 카드로 그린다(§13.21).
 */
export function SharePostDialog({
  open,
  onOpenChange,
  path,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 게시물 상세의 앱 내부 경로. 절대 URL은 보내는 순간에 만든다 — render 중에 `window`를 읽지 않는다. */
  path: string;
  title: string;
}) {
  const t = useT();
  const url = () => new URL(path, window.location.origin).toString();

  async function copyLink(close: () => void) {
    try {
      await navigator.clipboard.writeText(url());
      toast.success(t("링크를 복사했습니다."));
      close();
    } catch {
      toast.error(t("링크를 복사하지 못했습니다."));
    }
  }

  async function shareElsewhere(close: () => void) {
    try {
      await navigator.share({ title, url: url() });
      close();
    } catch (error) {
      // 공유 시트를 사용자가 닫은 것은 실패가 아니다.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(t("링크를 공유하지 못했습니다."));
    }
  }

  const canShareElsewhere =
    open &&
    typeof navigator.share === "function" &&
    window.matchMedia(NATIVE_SHARE_QUERY).matches;

  return (
    <SendToChatsDialog
      open={open}
      onOpenChange={onOpenChange}
      content={() => ({ body: url() })}
      subject={t("게시물")}
      footer={(close) => (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void copyLink(close)}
          >
            <LinkIcon data-icon="inline-start" />
            {t("링크 복사")}
          </Button>
          {canShareElsewhere ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void shareElsewhere(close)}
            >
              <ShareIcon data-icon="inline-start" />
              {t("다른 앱으로 공유")}
            </Button>
          ) : null}
        </>
      )}
    />
  );
}
