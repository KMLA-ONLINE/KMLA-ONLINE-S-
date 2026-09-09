import { data } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import {
  getNotificationCursor,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
} from "~/features/notifications";
import { NotificationInbox } from "~/features/notifications/components/notification-inbox";
import type { NotificationCursor } from "~/features/notifications";
import type { Route } from "./+types/notifications";
import { getQueryClient } from "~/shared/lib/query-client";

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

  // 읽음 처리는 셸 뱃지를 떨어뜨린다. 예전에는 form POST가 게이트를 재검증하면서 뱃지가
  // 딸려 왔지만, 이제 뱃지는 쿼리가 소유하므로 여기서 직접 무효화한다.
  if (intent === "mark-all") {
    const marked = await markAllNotificationsRead();
    await invalidateBadge();
    return { marked };
  }
  if (intent === "mark-one") {
    const notificationId = formData.get("notificationId");
    if (typeof notificationId !== "string" || !notificationId) {
      return data({ error: "알림을 찾을 수 없습니다." }, { status: 400 });
    }
    const marked = (await markNotificationRead(notificationId)) ? 1 : 0;
    await invalidateBadge();
    return { marked };
  }

  return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
}

function invalidateBadge() {
  return getQueryClient().invalidateQueries({
    queryKey: notificationKeys.badge(),
  });
}

export default function NotiPage({ loaderData }: Route.ComponentProps) {
  return <NotificationInbox initialPage={loaderData} />;
}
