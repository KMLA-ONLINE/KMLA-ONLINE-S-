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

// 헤더와 탭바를 고정으로 둔다. 자동 숨김은 숨길 때 둘의 자리를 음수 마진으로 반납해
// 스크롤 영역 높이를 바꾸는데, 목록이 길어 끝까지 내려가면 브라우저가 그만큼 scrollTop을
// 되돌리고 그 보정이 다시 "위로 올림"으로 읽혀 숨김과 표시가 무한히 뒤집힌다 — 헤더가 떨린다.
export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
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
