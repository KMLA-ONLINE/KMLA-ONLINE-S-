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
import { useOffline } from "~/shared/hooks/use-offline";
import { Button } from "~/shared/ui/button";

export function NotificationPermissionCard({
  profileId,
}: {
  profileId: number;
}) {
  const [eligible, setEligible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const offline = useOffline();
  const visible = eligible && !offline && !dismissed;

  useEffect(() => {
    if (hasHandledNotificationPrompt(profileId)) return;
    let cancelled = false;
    void getPushSupport().then((support) => {
      // 아직 한 번도 묻지 않은 기기에만 띄운다(기능 명세 §14.10). 허용한 기기의 서버 구독 확인은
      // 앱을 열 때 빠진 기록을 다시 등록하는 중이거나 요청이 실패하면 "아니오"로 올 수 있어 믿지 않는다.
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

  if (!visible) return null;

  return (
    <section
      aria-labelledby="notification-permission-title"
      className="mx-4 flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm md:mx-1 md:flex-row md:items-center"
    >
      <span className="w-fit rounded-xl bg-primary/10 p-2.5 text-primary">
        <BellRingIcon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="notification-permission-title" className="font-semibold">
          중요한 소식을 기기에서도 받아보세요
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          댓글과 답글, 그룹 가입 결과를 알려드립니다. 세부 유형은 알림 설정에서
          바꿀 수 있습니다.
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="ghost" onClick={dismiss} disabled={pending}>
          닫기
        </Button>
        <Button onClick={() => void enable()} disabled={pending}>
          {pending ? "설정 중" : "알림 받기"}
        </Button>
      </div>
    </section>
  );
}
