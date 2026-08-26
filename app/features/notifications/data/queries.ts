import {
  getNotificationCursor,
  NOTIFICATION_PAGE_SIZE,
  sanitizeNotificationDestination,
} from "~/features/notifications/model/notifications";
import type {
  NotificationCursor,
  GroupNotificationPreference,
  NotificationPage,
  NotificationPreferences,
} from "~/features/notifications/model/types";
import { getSupabase } from "~/shared/supabase/client";

export async function listNotifications(
  cursor: NotificationCursor | null,
): Promise<NotificationPage["items"]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("list_my_notifications", {
    p_limit: NOTIFICATION_PAGE_SIZE,
    p_before_id: cursor?.beforeId,
    p_before_last_activity_at: cursor?.beforeLastActivityAt,
  });
  if (error) throw error;

  const paths = [
    ...new Set(
      data.flatMap((item) => {
        const path = item.actor_avatar_path;
        if (!path || /^https?:\/\//i.test(path)) return [];
        return [path];
      }),
    ),
  ];
  const avatarUrls = new Map<string, string>();
  for (const item of data) {
    if (/^https?:\/\//i.test(item.actor_avatar_path)) {
      avatarUrls.set(item.actor_avatar_path, item.actor_avatar_path);
    }
  }
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("profile-media")
      .createSignedUrls(paths, 3600);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl)
        avatarUrls.set(item.path, item.signedUrl);
    }
  }

  return data.map(({ actor_avatar_path: path, ...item }) => ({
    ...item,
    actor_avatar_url: avatarUrls.get(path) ?? null,
  }));
}

export async function loadNotificationPage(
  cursor: NotificationCursor | null,
): Promise<NotificationPage> {
  const items = await listNotifications(cursor);
  return { items, nextCursor: getNotificationCursor(items) };
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const { data, error } = await getSupabase().rpc(
    "get_my_notification_preferences",
  );
  if (error) throw error;
  const preferences = data[0];
  if (!preferences) throw new Error("Notification preferences are unavailable");
  return preferences;
}

export async function getRecentUnreadNotificationCount(): Promise<number> {
  const { data, error } = await getSupabase().rpc(
    "get_my_recent_unread_notification_count",
  );
  if (error) throw error;
  return data;
}

export async function listMyGroupNotificationPreferences(): Promise<
  GroupNotificationPreference[]
> {
  const { data, error } = await getSupabase()
    .from("group_memberships")
    .select(
      "group_id, notification_level, new_post_push_enabled, groups!inner(name)",
    )
    .order("joined_at", { ascending: false });
  if (error) throw error;

  return data.map((item) => ({
    groupId: item.group_id,
    groupName: item.groups.name,
    level: item.notification_level,
    newPostPushEnabled: item.new_post_push_enabled,
  }));
}

export async function resolveNotificationDestination(
  notificationId: string,
): Promise<string | null> {
  const supabase = getSupabase();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) return null;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      notificationId,
    )
  ) {
    return "/noti";
  }

  const { data, error } = await supabase.rpc(
    "resolve_my_notification_destination",
    { p_notification_id: notificationId },
  );
  if (error?.code === "P0002" || error?.code === "42501") return "/noti";
  if (error) throw error;
  return sanitizeNotificationDestination(data);
}
