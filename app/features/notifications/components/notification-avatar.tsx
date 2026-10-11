import { ShieldIcon } from "lucide-react";

import type { NotificationItem } from "~/features/notifications/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";

/**
 * 알림 행의 보낸 주체. 사람이 아니면 `UserAvatar`의 빈 실루엣과 구분되도록 표식 타일을 그린다.
 * 알림 종류는 본문 문장이 이미 말하므로 배지를 겹치지 않는다.
 */
export function NotificationAvatar({
  item,
  name,
}: {
  item: NotificationItem;
  name: string;
}) {
  if (item.actor_identity === "system") {
    return (
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
        <img src="/logo-notext.svg" alt="" className="size-6" />
      </span>
    );
  }

  if (item.actor_identity === "staff") {
    return (
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300">
        <ShieldIcon className="size-5" aria-hidden="true" />
      </span>
    );
  }

  return (
    <UserAvatar
      src={item.actor_avatar_url}
      name={name}
      className="size-11 shrink-0"
    />
  );
}
