import type {
  GroupNotificationLevel,
  NotificationPreferences,
} from "~/features/notifications/model/types";
import { getSupabase } from "~/shared/supabase/client";

export async function markAllNotificationsRead(): Promise<number> {
  const { data, error } = await getSupabase().rpc(
    "mark_all_my_notifications_read",
  );
  if (error) throw error;
  return data;
}

export interface PostOpenedResult {
  /** 그 글이 그룹 새 게시물 수에 들어 있었다. */
  countedAsNew: boolean;
  /** 이번에 읽음으로 바뀐 그 글의 알림 수. */
  notificationsRead: number;
}

/** 게시물 상세를 열었다. 서버가 그 글을 새 게시물 수에서 빼고, 내게 온 그 글의 알림을 읽음 처리한다. */
export async function markPostOpened(
  postId: string,
): Promise<PostOpenedResult> {
  const { data, error } = await getSupabase()
    .rpc("mark_post_opened", { p_post_id: postId })
    .single();
  if (error) throw error;
  return {
    countedAsNew: data.counted_as_new,
    notificationsRead: data.notifications_read,
  };
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

/** `알림에 메시지 내용 가리기`. 계정의 모든 기기에 적용한다. */
export async function setMessagePreviewHidden(hidden: boolean): Promise<void> {
  const { error } = await getSupabase().rpc("set_my_message_preview_hidden", {
    p_hidden: hidden,
  });
  if (error) throw error;
}

export async function updateGroupNotificationPreferences(
  groupId: string,
  level: GroupNotificationLevel,
  contentPushEnabled: boolean,
  newPostPushEnabled: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc(
    "set_my_group_notification_preferences",
    {
      p_group_id: groupId,
      p_notification_level: level,
      p_content_push_enabled: contentPushEnabled,
      p_new_post_push_enabled: newPostPushEnabled,
    },
  );
  if (error) throw error;
}
