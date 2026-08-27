import { ShieldIcon } from "lucide-react";

import type { NotificationItem } from "~/features/notifications/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";

/**
 * 알림 한 행의 왼쪽 그림: 보낸 주체.
 *
 * 보낸 주체가 늘 사람인 것은 아니다. 시스템과 운영진 알림에 `UserAvatar`를 쓰면 사진을
 * 올리지 않은 사람과 똑같은 실루엣이 나와서, 목록에서 "누가 보냈는지"가 사라진다.
 * 그래서 사람이 아닌 주체는 아바타 대신 표식 타일을 그린다.
 *
 * 알림 종류는 그리지 않는다. 본문 문장이 이미 종류를 말하고 있어서, 아바타에 종류 배지까지
 * 겹치면 한 행에 같은 말이 두 번 들어가고 목록만 알록달록해진다.
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
        <img src="/logo.svg" alt="" className="size-6" />
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
