import { useQuery } from "@tanstack/react-query";
import {
  Maximize2Icon,
  MessagesSquareIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link } from "react-router";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import {
  ConversationRowContent,
  conversationRowClassName,
} from "~/features/messaging/components/conversation-row";
import { MiniRoom } from "~/features/messaging/components/mini-room";
import {
  conversationListQuery,
  unreadMessageCountQuery,
} from "~/features/messaging/data/cache";
import type { ConversationSummary } from "~/features/messaging/model/types";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";

/** 독이 보이는 폭. 홈의 학교생활 요약 사이드바와 같은 `lg`다(기능 명세 §13.28). */
const DOCK_VIEWPORT_QUERY = "(min-width: 64rem)";
/** 알약 버튼에 얹는 최근 대화 아바타 수. */
const PILL_AVATAR_COUNT = 3;

function subscribeToDockViewport(onChange: () => void) {
  const query = window.matchMedia(DOCK_VIEWPORT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isDockViewport() {
  return window.matchMedia(DOCK_VIEWPORT_QUERY).matches;
}

/**
 * 데스크톱 오른쪽 아래의 메시지 독(기능 명세 §13.28). 알약 버튼을 누르면 대화 목록 패널이 펼쳐지고,
 * 대화를 고르면 그 자리에 미니 대화방이 열린다.
 *
 * 셸의 layout에 한 번 마운트되어 화면을 옮겨도 펼침과 열어 둔 대화를 기억한다. `hidden`(메신저 화면)이거나
 * 좁은 화면이면 그리지 않되 state는 들고 있어 다시 보일 때 그대로 돌아온다. 그려지지 않은 동안에는 미니
 * 대화방도 내려가므로 보이지 않는 대화를 읽은 것으로 기록하지 않는다.
 */
export function MessageDock({ hidden = false }: { hidden?: boolean }) {
  const wide = useSyncExternalStore(
    subscribeToDockViewport,
    isDockViewport,
    () => false,
  );
  const shown = wide && !hidden;
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  // 탭 배지와 같은 쿼리라 요청은 늘지 않는다.
  const unread = useQuery(unreadMessageCountQuery()).data ?? 0;
  // 목록은 패널을 펼칠 때 읽는다. 서버가 목록을 줄 때 모든 대화의 마지막 메시지를 복호화하므로 접힌 독
  // 때문에 앱을 열 때마다 읽지 않는다. 알약의 아바타는 이미 읽어 둔 목록이 있을 때만 보인다.
  const list = useQuery({
    ...conversationListQuery(),
    enabled: shown && open,
  });

  // 패널 안에 포커스가 있을 때의 Esc는 패널을 접는다. 열린 대화상자 안의 Esc는 그쪽이 먼저 쓴다.
  const panelOpen = shown && open;
  useEffect(() => {
    if (!panelOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!panelRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      setOpen(false);
      pillRef.current?.focus();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [panelOpen]);

  if (!shown) return null;

  const recent = (list.data ?? []).slice(0, PILL_AVATAR_COUNT);
  const close = () => {
    setOpen(false);
    pillRef.current?.focus();
  };

  return (
    <div className="pointer-events-none absolute right-4 bottom-4 z-30 flex flex-col items-end gap-3">
      {open ? (
        <section
          ref={panelRef}
          id={panelId}
          aria-label="메시지 독"
          className="pointer-events-auto flex h-[min(70vh,35rem)] w-[22.5rem] flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-xl ring-1 ring-foreground/10"
        >
          {roomId ? (
            <MiniRoom
              key={roomId}
              conversationId={roomId}
              onBack={() => setRoomId(null)}
              onClose={close}
            />
          ) : (
            <DockConversationList
              conversations={list.data}
              pending={list.isPending}
              failed={list.isError}
              onRetry={() => void list.refetch()}
              onSelect={setRoomId}
              onClose={close}
            />
          )}
        </section>
      ) : null}
      <button
        ref={pillRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          unread > 0 ? `메시지, 읽지 않은 메시지 ${unread}개` : "메시지"
        }
        className="pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-card pr-3 pl-4 text-sm font-semibold shadow-lg ring-1 ring-foreground/10 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="relative flex">
          <MessagesSquareIcon aria-hidden className="size-5" />
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-action px-1 text-[0.625rem] leading-none font-semibold text-action-foreground tabular-nums ring-2 ring-card"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </span>
        <span aria-hidden>메시지</span>
        {recent.length > 0 ? (
          <span aria-hidden className="ml-1 flex -space-x-2">
            {recent.map((conversation) => (
              <ConversationAvatar
                key={conversation.id}
                conversation={conversation}
                className="size-7 ring-2 ring-card"
              />
            ))}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/** 독의 대화 목록. 메신저 목록과 같은 줄을 쓰되 새 채팅과 숨기기는 두지 않는다(기능 명세 §13.28). */
function DockConversationList({
  conversations,
  pending,
  failed,
  onRetry,
  onSelect,
  onClose,
}: {
  conversations: ConversationSummary[] | undefined;
  pending: boolean;
  failed: boolean;
  onRetry: () => void;
  onSelect: (conversationId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(
    search.trim().toLocaleLowerCase("ko"),
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const filtered = deferredSearch
    ? (conversations ?? []).filter(({ name }) =>
        name.toLocaleLowerCase("ko").includes(deferredSearch),
      )
    : (conversations ?? []);

  useEffect(() => {
    searchInput.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-4">
        <h2 className="min-w-0 flex-1 text-base font-bold">메시지</h2>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="메신저에서 크게 열기"
          render={<Link to="/messenger" />}
        >
          <Maximize2Icon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="메시지 독 닫기"
          onClick={onClose}
        >
          <XIcon aria-hidden />
        </Button>
      </header>

      <div className="relative mx-3 my-2 shrink-0">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={searchInput}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="채팅 검색"
          aria-label="채팅 검색"
          className="rounded-full border-0 bg-muted pr-4 pl-9"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 pb-2">
        {pending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : failed ? (
          <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            <p>채팅 목록을 불러오지 못했습니다.</p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              다시 시도
            </Button>
          </div>
        ) : filtered.length > 0 ? (
          <nav aria-label="채팅 목록" className="flex flex-col gap-0.5">
            {filtered.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={cn(conversationRowClassName, "w-full text-left")}
                onClick={() => onSelect(conversation.id)}
              >
                <ConversationRowContent conversation={conversation} />
              </button>
            ))}
          </nav>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {deferredSearch ? "채팅을 찾지 못했습니다" : "아직 채팅이 없습니다"}
          </p>
        )}
      </div>
    </>
  );
}
