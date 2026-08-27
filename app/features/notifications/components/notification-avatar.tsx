import {
  BanIcon,
  BellIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarXIcon,
  CircleCheckIcon,
  CrownIcon,
  FileCheckIcon,
  HeartIcon,
  LockOpenIcon,
  MessageCircleIcon,
  NewspaperIcon,
  PenLineIcon,
  ReplyIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
  Trash2Icon,
  UserCheckIcon,
  UserCogIcon,
  UserPlusIcon,
  UserXIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import type { NotificationItem } from "~/features/notifications/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";

/**
 * 배지 색은 "무슨 종류인가"가 아니라 "어떤 소식인가"를 말한다. 종류는 아이콘이 이미
 * 구분하므로 색까지 26가지로 쪼개면 목록이 알록달록해지기만 하고 읽히지는 않는다.
 * 색은 훑을 때 필요한 세 가지 — 평범한 활동, 공식 처리, 나쁜 소식 — 만 나눈다.
 */
type NotificationTone = "social" | "official" | "adverse" | "neutral";

const TONE_CLASS: Record<NotificationTone, string> = {
  social: "bg-primary/10 text-primary",
  // 앱 전체에서 sky는 '운영진·공식'을 뜻한다(게시물 행의 운영진 배지와 같은 색).
  official: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  adverse: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * `Record`라서 `notification_kind`에 값이 추가되면 타입 검사에서 걸린다. 새 알림이 조용히
 * 기본 아이콘으로 떨어지는 대신 여기서 한 번 결정하게 만드는 쪽이 낫다.
 */
const KIND_PRESENTATION: Record<
  NotificationItem["kind"],
  readonly [LucideIcon, NotificationTone]
> = {
  post_commented: [MessageCircleIcon, "social"],
  comment_replied: [ReplyIcon, "social"],
  post_reacted: [HeartIcon, "social"],
  comment_reacted: [HeartIcon, "social"],
  timeline_posted: [PenLineIcon, "social"],
  timeline_post_deleted: [Trash2Icon, "adverse"],
  group_posted: [NewspaperIcon, "social"],
  group_join_requested: [UserPlusIcon, "neutral"],
  group_join_approved: [UserCheckIcon, "official"],
  group_join_rejected: [UserXIcon, "adverse"],
  group_role_changed: [UserCogIcon, "official"],
  group_ownership_transferred: [CrownIcon, "official"],
  official_group_joined: [UsersIcon, "official"],
  group_policy_changed: [ScrollTextIcon, "neutral"],
  group_deleted: [Trash2Icon, "adverse"],
  post_moderated: [ShieldAlertIcon, "adverse"],
  comment_moderated: [ShieldAlertIcon, "adverse"],
  application_submitted: [FileCheckIcon, "neutral"],
  account_approved: [CircleCheckIcon, "official"],
  account_blocked: [BanIcon, "adverse"],
  account_unblocked: [LockOpenIcon, "official"],
  app_admin_granted: [ShieldCheckIcon, "official"],
  app_admin_revoked: [ShieldOffIcon, "adverse"],
  gongang_manager_granted: [CalendarCheckIcon, "official"],
  gongang_manager_revoked: [CalendarXIcon, "adverse"],
  gongang_preempted: [CalendarClockIcon, "adverse"],
};

/** 배포된 DB가 생성 타입보다 앞서 있을 때를 위한 마지막 안전망. */
const FALLBACK_PRESENTATION = [BellIcon, "neutral"] as const;

/**
 * 알림 한 행의 왼쪽 그림: 보낸 주체 + 종류 배지.
 *
 * 보낸 주체가 늘 사람인 것은 아니다. 시스템과 운영진 알림에 `UserAvatar`를 쓰면 사진을
 * 올리지 않은 사람과 똑같은 실루엣이 나와서, 목록에서 "누가 보냈는지"가 사라진다.
 * 그래서 사람이 아닌 주체는 아바타 대신 표식 타일을 그린다.
 */
export function NotificationAvatar({
  item,
  name,
}: {
  item: NotificationItem;
  name: string;
}) {
  const [Icon, tone] = KIND_PRESENTATION[item.kind] ?? FALLBACK_PRESENTATION;

  return (
    <span className="relative shrink-0">
      {item.actor_identity === "system" ? (
        <span className="flex size-11 items-center justify-center rounded-full bg-muted">
          <img src="/logo.svg" alt="" className="size-6" />
        </span>
      ) : item.actor_identity === "staff" ? (
        <span className="flex size-11 items-center justify-center rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300">
          <ShieldIcon className="size-5" aria-hidden="true" />
        </span>
      ) : (
        <UserAvatar
          src={item.actor_avatar_url}
          name={name}
          className="size-11"
        />
      )}

      {/* 종류는 본문 문장이 이미 말한다. 배지는 훑기용 신호라 낭독에서는 뺀다. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full ring-2 ring-card",
          TONE_CLASS[tone],
        )}
      >
        <Icon className="size-3" />
      </span>
    </span>
  );
}
