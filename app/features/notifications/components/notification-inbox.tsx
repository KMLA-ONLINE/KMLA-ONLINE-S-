import { BellIcon, CheckCheckIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { Link, useFetcher } from "react-router";

import { PageHeader } from "~/features/app-shell";
import { groupNotifications } from "~/features/notifications/model/notifications";
import type {
  NotificationItem,
  NotificationPage,
} from "~/features/notifications/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import { Empty, EmptyDescription, EmptyMedia } from "~/shared/ui/empty";
import { cn } from "~/shared/lib/utils";

function formatActivityTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function actorName(item: NotificationItem): string {
  if (item.actor_identity === "anonymous") return "익명";
  if (item.actor_identity === "staff") return "운영진";
  if (item.actor_identity === "system") return "KMLA Online";
  return item.actor_display_name || "탈퇴한 사용자";
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const readFetcher = useFetcher();
  const optimisticRead =
    (item.read_at !== "" && item.read_at !== null) ||
    readFetcher.formData?.get("notificationId") === item.id;
  const name = actorName(item);

  return (
    <Link
      to={`/noti/open/${encodeURIComponent(item.id)}`}
      onClick={() => {
        if (!optimisticRead) {
          void readFetcher.submit(
            { intent: "mark-one", notificationId: item.id },
            { method: "post", action: "/noti" },
          );
        }
      }}
      className={cn(
        "relative flex gap-3 px-4 py-3.5 transition-colors hover:bg-muted/60",
        !optimisticRead && "bg-primary/5",
      )}
    >
      <UserAvatar
        src={item.actor_avatar_url}
        name={name}
        className="mt-0.5 size-10 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5">
          <strong className="font-semibold">{name}</strong>{" "}
          {item.actor_count > 1 ? `외 ${item.actor_count - 1}명 ` : ""}
          {item.title}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatActivityTime(item.last_activity_at)}
        </span>
      </span>
      {!optimisticRead ? (
        <span
          aria-label="읽지 않음"
          className="mt-2 size-2 shrink-0 rounded-full bg-primary"
        />
      ) : null}
    </Link>
  );
}

function NotificationGroup({
  title,
  items,
}: {
  title: string;
  items: NotificationItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="border-b bg-muted/30 px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="divide-y">
        {items.map((item) => (
          <NotificationRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export function NotificationInbox({
  initialPage,
}: {
  initialPage: NotificationPage;
}) {
  const pageFetcher = useFetcher<NotificationPage>();
  const markAllFetcher = useFetcher();
  const [storedState, setStoredState] = useState<{
    initialPage: NotificationPage;
    additionalPages: NotificationPage[];
    processedPage: NotificationPage | null;
  }>({ initialPage, additionalPages: [], processedPage: null });

  let state = storedState;
  if (state.initialPage !== initialPage) {
    state = {
      initialPage,
      additionalPages: [],
      processedPage: pageFetcher.data ?? null,
    };
    setStoredState(state);
  }

  const fetchedPage = pageFetcher.data;
  if (fetchedPage && state.processedPage !== fetchedPage) {
    state = {
      ...state,
      additionalPages: [...state.additionalPages, fetchedPage],
      processedPage: fetchedPage,
    };
    setStoredState(state);
  }

  const pages = [initialPage, ...state.additionalPages];
  const items = Array.from(
    new Map(
      pages.flatMap((page) => page.items).map((item) => [item.id, item]),
    ).values(),
  );
  const nextCursor = pages.at(-1)?.nextCursor ?? null;
  const groups = groupNotifications(items);

  const markAllPending = markAllFetcher.state !== "idle";
  const allRead =
    markAllPending || items.every((item) => Boolean(item.read_at));

  return (
    <>
      <PageHeader
        title="알림"
        hideOnScroll
        actions={
          <Button
            variant="ghost"
            size="icon"
            nativeButton={false}
            aria-label="알림 설정"
            render={<Link to="/noti/settings" />}
          >
            <SettingsIcon />
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-2xl md:overflow-hidden md:rounded-xl md:border md:bg-card">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h1 className="hidden text-lg font-semibold md:block">알림</h1>
          <markAllFetcher.Form method="post" action="/noti" className="ml-auto">
            <input type="hidden" name="intent" value="mark-all" />
            <Button type="submit" variant="ghost" size="sm" disabled={allRead}>
              <CheckCheckIcon /> 모두 읽음
            </Button>
          </markAllFetcher.Form>
        </div>

        {items.length === 0 ? (
          <Empty className="border-0 py-20">
            <EmptyMedia variant="icon">
              <BellIcon />
            </EmptyMedia>
            <EmptyDescription>새 알림이 없습니다.</EmptyDescription>
          </Empty>
        ) : (
          <>
            <NotificationGroup title="최근 24시간" items={groups.recent} />
            <NotificationGroup title="이전 알림" items={groups.older} />
          </>
        )}

        {nextCursor ? (
          <div className="border-t p-4 text-center">
            <Button
              variant="outline"
              disabled={pageFetcher.state !== "idle"}
              onClick={() => {
                const search = new URLSearchParams({
                  beforeId: nextCursor.beforeId,
                  beforeLastActivityAt: nextCursor.beforeLastActivityAt,
                });
                void pageFetcher.load(`/noti?${search}`);
              }}
            >
              {pageFetcher.state === "loading"
                ? "불러오는 중"
                : "이전 알림 더 보기"}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
