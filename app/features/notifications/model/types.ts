import type { Database } from "~/shared/supabase/database.types";

type NotificationRow =
  Database["public"]["Functions"]["list_my_notifications"]["Returns"][number];

export type NotificationItem = Omit<NotificationRow, "actor_avatar_path"> & {
  actor_avatar_url: string | null;
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

export interface GroupNotificationPreference {
  groupId: string;
  groupName: string;
  level: GroupNotificationLevel;
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
