import type {
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
