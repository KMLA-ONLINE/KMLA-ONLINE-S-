import { ChevronLeftIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  searchMessages,
  type MessageSearchResult,
} from "~/features/messaging/data/queries";
import {
  formatMessageDay,
  formatMessageTime,
} from "~/features/messaging/model/message-time";
import type {
  MessageCursor,
  MessageParticipant,
} from "~/features/messaging/model/types";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";

interface SearchState {
  query: string;
  results: MessageSearchResult[];
  nextCursor: MessageCursor | null;
}

/**
 * 대화 내 검색(기능 명세 §13.13). 서버가 메시지를 복호화하며 거르므로 글자마다가 아니라 Enter로
 * 찾는다. 결과는 이 화면의 상태에만 두고, 닫으면 버린다. 결과를 고르면 원래 메시지로 이동해 강조한다.
 */
export function MessageSearchPanel({
  conversationId,
  participants,
  onClose,
  onSelect,
}: {
  conversationId: string;
  participants: Map<string, MessageParticipant>;
  onClose: () => void;
  onSelect: (result: MessageSearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // 검색을 열면 바로 입력할 수 있게 한다.
  useEffect(() => input.current?.focus(), []);

  // 검색은 복호화하며 훑어 느리다. 연달아 찾으면 마지막 요청의 결과만 반영한다.
  const latestRequest = useRef(0);

  async function run(term: string, cursor: MessageCursor | null) {
    const request = ++latestRequest.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await searchMessages(conversationId, term, cursor);
      if (request !== latestRequest.current) return;
      setState((current) => ({
        query: term,
        results:
          cursor && current?.query === term
            ? [...current.results, ...page.results]
            : page.results,
        nextCursor: page.nextCursor,
      }));
    } catch {
      if (request === latestRequest.current) setFailed(true);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }

  const term = query.trim();

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <form
        role="search"
        className="flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center gap-2 px-2 pt-[var(--app-safe-t)] shadow-sm md:h-16 md:px-4 md:pt-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (term) void run(term, null);
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="검색 닫기"
          onClick={onClose}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="대화에서 찾기"
            aria-label="대화에서 찾기"
            className="rounded-full border-0 bg-muted pl-9"
          />
        </div>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {state === null && !loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            찾을 말을 입력하고 Enter를 누르세요.
          </p>
        ) : null}
        {state?.results.length === 0 && !loading && !failed ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {state.nextCursor
              ? "최근 메시지에서는 찾지 못했습니다."
              : "찾는 메시지가 없습니다."}
          </p>
        ) : null}
        {state && state.results.length > 0 ? (
          <ul aria-label="검색 결과" className="flex flex-col gap-0.5">
            {state.results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => onSelect(result)}
                >
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {(result.senderId
                        ? participants.get(result.senderId)?.name
                        : undefined) ?? "알 수 없는 사용자"}
                    </span>
                    <time dateTime={result.sentAt} className="shrink-0">
                      {formatMessageDay(result.sentAt)}{" "}
                      {formatMessageTime(result.sentAt)}
                    </time>
                  </span>
                  <span className="line-clamp-2 text-sm [overflow-wrap:anywhere] break-keep">
                    {result.body}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {failed ? (
          <p role="alert" className="py-6 text-center text-sm text-destructive">
            찾지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
        ) : null}
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : state?.nextCursor ? (
          <div className="flex justify-center py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void run(state.query, state.nextCursor)}
            >
              이전 메시지에서 더 찾기
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
