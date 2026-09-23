import { loadNotificationPage } from "~/features/notifications";
import type { NotificationCursor } from "~/features/notifications";
import type { Route } from "./+types/notification-page";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const search = new URL(request.url).searchParams;
  const beforeId = search.get("beforeId");
  const beforeLastActivityAt = search.get("beforeLastActivityAt");
  const cursor: NotificationCursor | null =
    beforeId && beforeLastActivityAt
      ? { beforeId, beforeLastActivityAt }
      : null;

  return loadNotificationPage(cursor);
}

// 이전 페이지는 화면 로컬 snapshot이다. 전역 refresh가 마지막 cursor fetcher까지 다시
// 실행하면 첫 페이지와 함께 같은 RPC가 중복되므로 사용자가 누를 때만 읽는다.
export function shouldRevalidate() {
  return false;
}
