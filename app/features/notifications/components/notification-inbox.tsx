import { BellIcon, CheckCheckIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { Link, useFetcher } from "react-router";

import { PageHeader } from "~/features/app-shell";
import { NotificationAvatar } from "~/features/notifications/components/notification-avatar";
import { groupNotifications } from "~/features/notifications/model/notifications";
import type {
  NotificationItem,
  NotificationPage,
} from "~/features/notifications/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { Button } from "~/shared/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/shared/ui/empty";
import { Spinner } from "~/shared/ui/spinner";
import { cn } from "~/shared/lib/utils";

function isRead(item: NotificationItem): boolean {
  return Boolean(item.read_at);
}

function actorName(item: NotificationItem): string {
  if (item.actor_identity === "anonymous") return "익명";
  if (item.actor_identity === "staff") return "운영진";
  if (item.actor_identity === "system") return "KMLA Online";
  return item.actor_display_name || "탈퇴한 사용자";
}

/**
 * 한 행은 세 줄이다: 누가 / 무슨 일이 / 언제.
 *
 * `title`은 DB가 만든 완결된 문장("내 게시물에 새 댓글이 등록되었습니다.")이라 이름 뒤에
 * 그대로 이어 붙이면 조사가 어긋난다. 그래서 이름과 문장을 한 줄에 섞지 않고 위아래로 나눈다.
 */
function NotificationRow({
  item,
  forceRead,
}: {
  item: NotificationItem;
  forceRead: boolean;
}) {
  const readFetcher = useFetcher();
  const unread =
    !forceRead &&
    !isRead(item) &&
    readFetcher.formData?.get("notificationId") !== item.id;
  const name = actorName(item);
  const others = item.actor_count > 1 ? ` 외 ${item.actor_count - 1}명` : "";

  return (
    <Link
      to={`/noti/open/${encodeURIComponent(item.id)}`}
      onClick={() => {
        if (unread) {
          void readFetcher.submit(
            { intent: "mark-one", notificationId: item.id },
            { method: "post", action: "/noti" },
          );
        }
      }}
      className={cn(
        "flex gap-3 px-4 py-3 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        unread && "bg-primary/5 hover:bg-primary/10",
      )}
    >
      <NotificationAvatar item={item} name={name} />

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {name}
            {others ? (
              <span className="font-normal text-muted-foreground">
                {others}
              </span>
            ) : null}
          </span>
          {unread ? (
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
              <span className="sr-only">읽지 않음</span>
            </span>
          ) : null}
        </span>

        <span
          className={cn(
            "mt-0.5 text-sm break-keep",
            unread ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {item.title}
        </span>

        <RelativeTime
          value={item.last_activity_at}
          className="mt-1 text-xs text-muted-foreground"
        />
      </span>
    </Link>
  );
}

function NotificationGroup({
  title,
  items,
  forceRead,
}: {
  title: string;
  items: NotificationItem[];
  forceRead: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="px-4 pb-2 text-xs font-semibold tracking-wide text-muted-foreground md:px-1">
        {title}
      </h2>
      <ul className="divide-y border-y bg-card md:overflow-hidden md:rounded-xl md:border">
        {items.map((item) => (
          <li key={item.id}>
            <NotificationRow item={item} forceRead={forceRead} />
          </li>
        ))}
      </ul>
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

  // 제출 중과 그 뒤 revalidation까지가 idle이 아닌 구간이다. 그동안 행을 미리 읽음으로
  // 그려야 "모두 읽음"을 누른 순간 목록 전체가 함께 가라앉는다.
  const markAllPending = markAllFetcher.state !== "idle";
  const unreadCount = markAllPending
    ? 0
    : items.filter((item) => !isRead(item)).length;
  const loadingMore = pageFetcher.state !== "idle";

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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-4">
        <div className="flex items-center gap-2 px-4 pt-1 md:px-1 md:pt-0">
          <h1 className="hidden text-2xl font-semibold md:block">알림</h1>
          {unreadCount > 0 ? (
            <span className="text-sm text-muted-foreground">
              읽지 않음 {unreadCount}개
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            <markAllFetcher.Form method="post" action="/noti">
              <input type="hidden" name="intent" value="mark-all" />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={unreadCount === 0}
              >
                <CheckCheckIcon /> 모두 읽음
              </Button>
            </markAllFetcher.Form>
            {/* 모바일은 PageHeader가 같은 링크를 이미 들고 있다. 데스크톱에서는 그 헤더가
                숨겨지므로 여기에도 두지 않으면 설정으로 갈 길이 사라진다. */}
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              aria-label="알림 설정"
              className="hidden md:inline-flex"
              render={<Link to="/noti/settings" />}
            >
              <SettingsIcon />
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <Empty className="border-0 py-20">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon />
              </EmptyMedia>
              <EmptyTitle>새 알림이 없습니다</EmptyTitle>
              <EmptyDescription>
                댓글·반응과 그룹 소식이 도착하면 여기에 모입니다.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <NotificationGroup
              title="최근 24시간"
              items={groups.recent}
              forceRead={markAllPending}
            />
            <NotificationGroup
              title="이전 알림"
              items={groups.older}
              forceRead={markAllPending}
            />
          </>
        )}

        {nextCursor ? (
          <div className="px-4 md:px-1">
            <Button
              variant="outline"
              className="w-full"
              disabled={loadingMore}
              onClick={() => {
                const search = new URLSearchParams({
                  beforeId: nextCursor.beforeId,
                  beforeLastActivityAt: nextCursor.beforeLastActivityAt,
                });
                void pageFetcher.load(`/noti?${search}`);
              }}
            >
              {loadingMore ? (
                <>
                  <Spinner /> 불러오는 중
                </>
              ) : (
                "이전 알림 더 보기"
              )}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
