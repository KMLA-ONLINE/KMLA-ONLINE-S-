import { BellRingIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  enableWebPush,
  getPushSupport,
} from "~/features/notifications/data/push";
import {
  hasHandledNotificationPrompt,
  recordNotificationEnabled,
  recordNotificationPromptHandled,
} from "~/features/notifications/model/prompt-storage";
import {
  setPromptActive,
  usePromptActive,
} from "~/shared/lib/prompt-coordinator";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

/**
 * 가입 승인 뒤 앱에 들어오면 Web Push 용도를 먼저 설명하는 창(기능 명세 §14.10). 알림함 안의
 * 카드로만 두었을 때는 알림함을 열어야만 보여서 켜는 사람이 드물었다. 셸에 한 번 마운트한다.
 * 여기서 넘기면 알림함 카드(`NotificationPermissionCard`)가 몇 번 더 권한다.
 *
 * Push를 실제로 쓸 수 있는 기기에만 띄우므로 브라우저 이름은 보지 않는다. iOS Safari 탭은
 * Push가 없고(`ios-browser`) 홈 화면 앱이 되어야 뜬다.
 */
export function NotificationPermissionPrompt({
  profileId,
}: {
  profileId: number;
}) {
  const [eligible, setEligible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  // 연결 끊김·새 버전 안내가 떠 있는 동안 미룬다(기능 명세 §3.7). 설치 안내는 이 창을 보고 물러난다.
  const offline = usePromptActive("offline");
  const updating = usePromptActive("service-worker");
  const visible = eligible && !dismissed && !offline && !updating;

  useEffect(() => {
    if (hasHandledNotificationPrompt(profileId)) return;
    let cancelled = false;
    void getPushSupport().then((support) => {
      // 아직 한 번도 묻지 않은 기기에만 띄운다. 허용한 기기의 서버 구독 확인은 앱을 열 때 빠진
      // 기록을 다시 등록하는 중이거나 요청이 실패하면 "아니오"로 올 수 있어 믿지 않는다.
      // 허용한 뒤 끈 사람은 알림 설정에서 다시 켠다. 거절한 기기에는 묻기를 반복하지 않는다.
      if (!cancelled) {
        setEligible(
          support.state === "available" && support.permission === "default",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    setPromptActive("notification", visible);
    return () => setPromptActive("notification", false);
  }, [visible]);

  const dismiss = () => {
    recordNotificationPromptHandled(profileId);
    setDismissed(true);
  };

  const enable = async () => {
    setPending(true);
    try {
      const result = await enableWebPush();
      // 브라우저 권한 창을 그냥 닫았으면 넘긴 것과 같다. 알림함 카드가 다시 권한다.
      if (result.state === "available" && result.subscribed) {
        recordNotificationEnabled(profileId);
      } else {
        recordNotificationPromptHandled(profileId);
      }
      setDismissed(true);
    } catch (error) {
      console.error("Failed to enable Web Push", error);
      toast.error("알림을 켜지 못했습니다. 알림 설정에서 다시 시도해 주세요.");
      setPending(false);
    }
  };

  return (
    <Dialog
      open={visible}
      // 화면을 쓰던 손가락이 배경을 눌러 읽기 전에 닫히지 않게 한다. 나가려면 버튼을 누른다.
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next && !pending) dismiss();
      }}
    >
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <span className="mx-auto w-fit rounded-xl bg-primary/10 p-2.5 text-primary sm:mx-0">
            <BellRingIcon aria-hidden className="size-5" />
          </span>
          <DialogTitle>알림을 켜시겠어요?</DialogTitle>
          <DialogDescription>
            댓글과 답글, 그룹 가입 결과를 이 기기로 알려드려요. 세부 유형은 알림
            설정에서 바꿀 수 있어요.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            size="lg"
            onClick={dismiss}
            disabled={pending}
          >
            나중에
          </Button>
          <Button size="lg" onClick={() => void enable()} disabled={pending}>
            {pending ? "설정 중" : "알림 받기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
