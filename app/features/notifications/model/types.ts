import type { Database } from "~/shared/supabase/database.types";

type NotificationRow =
  Database["public"]["Functions"]["list_my_notifications"]["Returns"][number];

/**
 * 생성 타입은 RPC의 모든 열을 non-null로 적는다. 댓글 본문과 반응 종류는 해당 kind가 아니거나
 * 대상이 사라지면 실제로 null이 오므로 여기서 바로잡는다.
 */
export type NotificationItem = Omit<
  NotificationRow,
  "actor_avatar_path" | "comment_excerpt" | "reaction"
> & {
  actor_avatar_url: string | null;
  comment_excerpt: string | null;
  reaction: Database["public"]["Enums"]["post_reaction"] | null;
};
export type NotificationPreferences =
  Database["public"]["Functions"]["get_my_notification_preferences"]["Returns"][number];

export interface NotificationCursor {
  beforeId: string;
  beforeLastActivityAt: string;
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: NotificationCursor | null;
}

export type GroupNotificationLevel =
  Database["public"]["Enums"]["group_notification_level"];

/**
 * 그룹 기본 알림 수준이 종류에 따라 다르므로(공식 `all`, 비공식 `direct`) 설정 화면이
 * "기본값과 다른 그룹"을 가려내려면 종류를 함께 알아야 한다.
 *
 * `~/features/groups`의 `GroupKind`를 쓰지 않고 생성 타입에서 직접 파생한다 — 그룹 화면이
 * 이 feature의 다이얼로그를 가져다 쓰므로 반대 방향 import를 두면 순환이 된다.
 */
export type GroupNotificationGroupKind =
  Database["public"]["Enums"]["group_kind"];

export interface GroupNotificationPreference {
  groupId: string;
  groupName: string;
  groupKind: GroupNotificationGroupKind;
  level: GroupNotificationLevel;
  contentPushEnabled: boolean;
  newPostPushEnabled: boolean;
}

export type PushSupport =
  | { state: "unsupported" }
  | { state: "unconfigured" }
  | { state: "ios-browser" }
  | {
      state: "available";
      permission: NotificationPermission;
      subscribed: boolean;
    };
