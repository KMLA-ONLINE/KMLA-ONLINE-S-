import { data } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import {
  getNotificationCursor,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "~/features/notifications";
import { NotificationInbox } from "~/features/notifications/components/notification-inbox";
import type { NotificationCursor } from "~/features/notifications";
import type { Route } from "./+types/notifications";

export const handle = defineAppChrome({
  header: "hide-on-scroll",
  bottomNav: "hide-on-scroll",
  pullToRefresh: true,
});

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const search = new URL(request.url).searchParams;
  const beforeId = search.get("beforeId");
  const beforeLastActivityAt = search.get("beforeLastActivityAt");
  const cursor: NotificationCursor | null =
    beforeId && beforeLastActivityAt
      ? { beforeId, beforeLastActivityAt }
      : null;
  const items = await listNotifications(cursor);
  return { items, nextCursor: getNotificationCursor(items) };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "mark-all") {
    return { marked: await markAllNotificationsRead() };
  }
  if (intent === "mark-one") {
    const notificationId = formData.get("notificationId");
    if (typeof notificationId !== "string" || !notificationId) {
      return data({ error: "알림을 찾을 수 없습니다." }, { status: 400 });
    }
    return { marked: (await markNotificationRead(notificationId)) ? 1 : 0 };
  }

  return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
}

export default function NotiPage({ loaderData }: Route.ComponentProps) {
  return <NotificationInbox initialPage={loaderData} />;
}
