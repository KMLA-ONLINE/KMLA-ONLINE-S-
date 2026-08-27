import type {
  GroupNotificationLevel,
  GroupNotificationGroupKind,
  GroupNotificationPreference,
  NotificationCursor,
  NotificationItem,
} from "~/features/notifications/model/types";

export const NOTIFICATION_PAGE_SIZE = 20;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function groupNotifications(
  items: NotificationItem[],
  now = new Date(),
) {
  const threshold = now.getTime() - RECENT_WINDOW_MS;
  const recent: NotificationItem[] = [];
  const older: NotificationItem[] = [];

  for (const item of items) {
    (new Date(item.last_activity_at).getTime() > threshold
      ? recent
      : older
    ).push(item);
  }

  return { recent, older };
}

/**
 * 새로 가입할 때 서버가 넣어 주는 기본 알림 수준(기술 설계 §3.3). 공식 그룹은 전체 소식을
 * 받고 비공식 그룹은 나와 직접 관련된 활동만 받는다.
 */
export function getDefaultGroupNotificationLevel(
  kind: GroupNotificationGroupKind,
): GroupNotificationLevel {
  return kind === "official" ? "all" : "direct";
}

/**
 * 손대지 않은 그룹인지. 알림 설정 화면은 이 값이 `false`인 그룹만 나열한다 — 가입한 그룹을
 * 전부 늘어놓으면 목록이 길기만 하고, 정작 사용자가 바꾼 그룹이 그 안에 묻힌다.
 */
export function isDefaultGroupNotificationPreference(
  preference: GroupNotificationPreference,
): boolean {
  return (
    preference.level ===
      getDefaultGroupNotificationLevel(preference.groupKind) &&
    preference.contentPushEnabled &&
    !preference.newPostPushEnabled
  );
}

export function getNotificationCursor(
  items: NotificationItem[],
  pageSize = NOTIFICATION_PAGE_SIZE,
): NotificationCursor | null {
  if (items.length < pageSize) return null;
  const last = items.at(-1);
  if (!last) return null;

  return {
    beforeId: last.id,
    beforeLastActivityAt: last.last_activity_at,
  };
}

export function sanitizeNotificationDestination(destination: string): string {
  if (!destination.startsWith("/") || destination.startsWith("//")) {
    return "/noti";
  }

  try {
    const url = new URL(destination, "https://kmla.online");
    return url.origin === "https://kmla.online"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/noti";
  } catch {
    return "/noti";
  }
}
