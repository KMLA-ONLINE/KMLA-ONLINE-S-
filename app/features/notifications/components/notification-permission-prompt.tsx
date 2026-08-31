import { BellRingIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  enableWebPush,
  getPushSupport,
} from "~/features/notifications/data/push";
import {
  hasHandledNotificationPrompt,
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

export function NotificationPermissionPrompt({
  profileId,
}: {
  profileId: number;
}) {
  const [eligible, setEligible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const offlinePromptActive = usePromptActive("offline");
  const serviceWorkerPromptActive = usePromptActive("service-worker");
  const installPromptActive = usePromptActive("install");
  // 연결이 없으면 구독 등록이 서버에 닿지 못한다. 물어봐야 실패시킬 뿐이라 미룬다.
  const blocked =
    offlinePromptActive || serviceWorkerPromptActive || installPromptActive;
  const open = eligible && !blocked && !dismissed;

  useEffect(() => {
    if (hasHandledNotificationPrompt(profileId)) return;
    let cancelled = false;
    void getPushSupport().then((support) => {
      if (!cancelled) {
        setEligible(
          support.state === "available" &&
            support.permission !== "denied" &&
            !support.subscribed,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    setPromptActive("notification", open);
    return () => setPromptActive("notification", false);
  }, [open]);

  const dismiss = () => {
    recordNotificationPromptHandled(profileId);
    setDismissed(true);
  };

  const enable = async () => {
    setPending(true);
    try {
      await enableWebPush();
      dismiss();
    } catch (error) {
      console.error("Failed to enable Web Push", error);
      toast.error("알림을 켜지 못했습니다. 알림 설정에서 다시 시도해 주세요.");
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <span className="mb-2 w-fit rounded-xl bg-primary/10 p-3 text-primary">
            <BellRingIcon className="size-6" />
          </span>
          <DialogTitle>중요한 소식을 놓치지 마세요</DialogTitle>
          <DialogDescription>
            댓글과 답글, 그룹 가입 결과, 계정과 학교 기능의 중요한 변화를 이
            기기에서 알려드립니다. 세부 유형은 알림 설정에서 언제든 바꿀 수
            있습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss} disabled={pending}>
            나중에
          </Button>
          <Button onClick={() => void enable()} disabled={pending}>
            {pending ? "설정 중" : "알림 받기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
