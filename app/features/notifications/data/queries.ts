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
// 배럴이 아니라 모듈을 직접 가져온다. `~/features/auth`는 자기 mutations를 통해 이 feature를
// 다시 참조하므로 배럴로 들어가면 순환이 된다.
import { readLiveSession } from "~/features/auth/data/queries";
// 배럴(`~/features/profiles`)은 화면 컴포넌트를 전부 끌고 온다. 서명 헬퍼만 필요하다.
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { getSupabase } from "~/shared/supabase/client";

export async function listNotifications(
  cursor: NotificationCursor | null,
): Promise<NotificationPage["items"]> {
  const { data, error } = await getSupabase().rpc("list_my_notifications", {
    p_limit: NOTIFICATION_PAGE_SIZE,
    p_before_id: cursor?.beforeId,
    p_before_last_activity_at: cursor?.beforeLastActivityAt,
  });
  if (error) throw error;

  // 알림함은 staleTime이 0이라 Realtime과 focus 복귀마다 다시 읽힌다. 여기서 직접
  // `createSignedUrls`를 부르면 그때마다 같은 아바타에 새 토큰이 붙어 URL이 바뀌고,
  // `<img>`가 브라우저 캐시를 놓친다. 공용 캐시를 지나면 55분 동안 같은 URL이 나온다.
  const avatarUrls = await createProfileMediaUrls(
    data.map((item) => item.actor_avatar_path),
  );

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

const GROUP_PREFERENCE_COLUMNS =
  "group_id, notification_level, content_push_enabled, new_post_push_enabled, groups!inner(name, kind)";

export async function listMyGroupNotificationPreferences(): Promise<
  GroupNotificationPreference[]
> {
  const { data, error } = await getSupabase()
    .from("group_memberships")
    .select(GROUP_PREFERENCE_COLUMNS)
    .order("joined_at", { ascending: false });
  if (error) throw error;

  return data.map((item) => ({
    groupId: item.group_id,
    groupName: item.groups.name,
    groupKind: item.groups.kind,
    level: item.notification_level,
    contentPushEnabled: item.content_push_enabled,
    newPostPushEnabled: item.new_post_push_enabled,
  }));
}

/**
 * 그룹 화면의 알림 다이얼로그가 열릴 때만 읽는 한 그룹치 설정.
 *
 * 그룹 상세 loader에 얹지 않는 이유는 이 값을 그리는 화면이 없기 때문이다 — 다이얼로그를
 * 열지 않는 대다수 방문에서 매번 한 번씩 더 왕복할 이유가 없다.
 *
 * 멤버가 아니면 행이 없고, 그때는 `null`을 돌려준다.
 */
export async function getMyGroupNotificationPreference(
  groupId: string,
): Promise<GroupNotificationPreference | null> {
  const { data, error } = await getSupabase()
    .from("group_memberships")
    .select(GROUP_PREFERENCE_COLUMNS)
    .eq("group_id", groupId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    groupId: data.group_id,
    groupName: data.groups.name,
    groupKind: data.groups.kind,
    level: data.notification_level,
    contentPushEnabled: data.content_push_enabled,
    newPostPushEnabled: data.new_post_push_enabled,
  };
}

export async function resolveNotificationDestination(
  notificationId: string,
): Promise<string | null> {
  const supabase = getSupabase();
  const session = await readLiveSession();
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
