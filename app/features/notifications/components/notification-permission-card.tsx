import { BellOffIcon, BellRingIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  enableWebPush,
  getPushSupport,
  isWebPushOffOnThisDevice,
} from "~/features/notifications/data/push";
import {
  recordInboxReminderDismissed,
  recordNotificationEnabled,
  shouldShowInboxReminder,
} from "~/features/notifications/model/prompt-storage";
import { useOffline } from "~/shared/hooks/use-offline";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";

/**
 * 첫 진입 창(`NotificationPermissionPrompt`)에서 넘긴 사람에게 알림함에서 다시 권하는 카드.
 * 닫기를 `INBOX_REMINDER_LIMIT`번 누르면 더 띄우지 않는다. 창에 아직 답하지 않았으면 그 창이
 * 먼저라 띄우지 않는다.
 *
 * 카드가 없는 동안 이 기기의 Push가 꺼져 있으면 알림 설정으로 가는 한 줄을 대신 둔다. 닫을 수 없고
 * 브라우저 권한도 묻지 않는다. 묻는 일은 첫 진입 창과 카드가 맡는다.
 */
export function NotificationPermissionCard({
  profileId,
}: {
  profileId: number;
}) {
  const t = useT();
  const [eligible, setEligible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const [pushOff, setPushOff] = useState(false);
  const offline = useOffline();
  const visible = eligible && !offline && !dismissed;

  useEffect(() => {
    let cancelled = false;
    void isWebPushOffOnThisDevice().then((off) => {
      if (!cancelled) setPushOff(off);
    });
    return () => {
      cancelled = true;
    };
  }, [dismissed]);

  useEffect(() => {
    if (!shouldShowInboxReminder(profileId)) return;
    let cancelled = false;
    void getPushSupport().then((support) => {
      // 브라우저 권한을 아직 정하지 않은 기기에만 띄운다(기능 명세 §14.10). 거절한 기기에는 브라우저가
      // 다시 묻지 못하고, 허용한 뒤 끈 사람은 알림 설정에서 다시 켠다.
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
    recordInboxReminderDismissed(profileId);
    setDismissed(true);
  };

  const enable = async () => {
    setPending(true);
    try {
      const result = await enableWebPush();
      // 브라우저 권한 창을 그냥 닫았으면 닫기와 같게 센다.
      if (result.state === "available" && result.subscribed) {
        recordNotificationEnabled(profileId);
      } else {
        recordInboxReminderDismissed(profileId);
      }
      setDismissed(true);
    } catch (error) {
      console.error("Failed to enable Web Push", error);
      toast.error(
        t("알림을 켜지 못했습니다. 알림 설정에서 다시 시도해 주세요."),
      );
      setPending(false);
    }
  };

  if (!visible) {
    if (!pushOff) return null;
    return (
      <p className="mx-4 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground md:mx-1">
        <BellOffIcon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          {t("이 기기에서 알림이 꺼져 있어요")}
        </span>
        <Link
          to="/settings/noti"
          className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("알림 설정")}
        </Link>
      </p>
    );
  }

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
          {t("중요한 소식을 기기에서도 받아보세요")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "댓글·답글과 그룹 가입 결과를 이 기기로 알립니다. 알림 종류는 알림 설정에서 변경할 수 있습니다.",
          )}
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="ghost" onClick={dismiss} disabled={pending}>
          {t("닫기")}
        </Button>
        <Button onClick={() => void enable()} disabled={pending}>
          {pending ? t("설정 중") : t("알림 받기")}
        </Button>
      </div>
    </section>
  );
}
