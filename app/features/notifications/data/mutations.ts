import type {
  GroupNotificationLevel,
  NotificationPreferences,
} from "~/features/notifications/model/types";
import { getSupabase } from "~/shared/supabase/client";

export async function markNotificationRead(id: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("mark_my_notification_read", {
    p_notification_id: id,
  });
  if (error) throw error;
  return data;
}

export async function markAllNotificationsRead(): Promise<number> {
  const { data, error } = await getSupabase().rpc(
    "mark_all_my_notifications_read",
  );
  if (error) throw error;
  return data;
}

export async function updateNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<void> {
  const { error } = await getSupabase().rpc(
    "update_my_notification_preferences",
    {
      p_account_push_enabled: preferences.account_push_enabled,
      p_content_push_enabled: preferences.content_push_enabled,
      p_group_push_enabled: preferences.group_push_enabled,
      p_school_push_enabled: preferences.school_push_enabled,
      p_timeline_push_enabled: preferences.timeline_push_enabled,
    },
  );
  if (error) throw error;
}

export async function updateGroupNotificationPreferences(
  groupId: string,
  level: GroupNotificationLevel,
  newPostPushEnabled: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc(
    "set_my_group_notification_preferences",
    {
      p_group_id: groupId,
      p_notification_level: level,
      p_new_post_push_enabled: newPostPushEnabled,
    },
  );
  if (error) throw error;
}
