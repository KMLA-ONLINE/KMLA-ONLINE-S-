import { ChevronLeftIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, useFetcher, useSearchParams } from "react-router";

import { GroupMobileDiscoverCard } from "~/features/groups/components/group-mobile-discover-card";
import { GroupSummaryCard } from "~/features/groups/components/group-summary-card";
import { hasMinimumGroupSearchLength } from "~/features/groups/model/format";
import type { GroupDiscoveryPage } from "~/features/groups/model/types";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { Button } from "~/shared/ui/button";
import { Checkbox } from "~/shared/ui/checkbox";
import { Field, FieldLabel } from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";

interface DiscoveryLoaderData {
  page: GroupDiscoveryPage;
  query: string;
  includeJoined: boolean;
}

interface PaginationState {
  initialPage: GroupDiscoveryPage;
  additionalPages: GroupDiscoveryPage[];
  processedData: DiscoveryLoaderData | undefined;
}

export function GroupDiscoverScreen({
  initialPage,
  query,
  includeJoined,
  profileId,
}: {
  initialPage: GroupDiscoveryPage;
  query: string;
  includeJoined: boolean;
  profileId: number;
}) {
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const [input, setInput] = useState(query);
  const [composing, setComposing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<DiscoveryLoaderData>();
  const inputRef = useRef<HTMLInputElement>(null);
  const focusAfterOpenRef = useRef(false);
  const [pagination, setPagination] = useState<PaginationState>({
    initialPage,
    additionalPages: [],
    processedData: undefined,
  });

  if (pagination.initialPage !== initialPage) {
    setPagination({
      initialPage,
      additionalPages: [],
      processedData: fetcher.data,
    });
  } else if (fetcher.data && pagination.processedData !== fetcher.data) {
    setPagination({
      ...pagination,
      additionalPages: [...pagination.additionalPages, fetcher.data.page],
      processedData: fetcher.data,
    });
  }

  const pages = [pagination.initialPage, ...pagination.additionalPages];
  const groups = pages.flatMap((page) => page.groups);
  const nextCursor = pages.at(-1)?.nextCursor ?? null;

  useEffect(() => {
    if (!searchOpen || !focusAfterOpenRef.current) return;
    focusAfterOpenRef.current = false;
    inputRef.current?.focus();
  }, [searchOpen]);

  function loadMore() {
    if (!nextCursor || fetcher.state !== "idle") return;

    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (includeJoined) next.set("includeJoined", "true");
    next.set("afterRank", String(nextCursor.rank));
    next.set("afterMemberCount", String(nextCursor.memberCount));
    next.set("afterId", nextCursor.groupId);
    void fetcher.load(`/groups/discover?${next}`);
  }

  const pending = fetcher.state !== "idle";
  const sentinelRef = useInfiniteScroll(loadMore, {
    enabled: Boolean(nextCursor),
    pending,
  });

  function openSearch() {
    focusAfterOpenRef.current = true;
    setSearchOpen(true);
  }

  function closeSearch() {
    setInput("");
    setSearchOpen(false);
    if (!query) return;

    const next = new URLSearchParams(searchParams);
    next.delete("q");
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }

  function changeJoinedFilter(checked: boolean) {
    const next = new URLSearchParams(searchParams);
    if (checked) next.set("includeJoined", "true");
    else next.delete("includeJoined");
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }

  const canSearch = hasMinimumGroupSearchLength(input);

  return (
    <div className="mx-auto flex w-full flex-col gap-5 px-4 py-5 md:px-0 md:py-0">
      <div className="hidden flex-col gap-2 md:flex">
        <Link
          to="/groups"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
          그룹
        </Link>
        <h1 className="text-2xl font-semibold">비공식 그룹 찾기</h1>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        {searchOpen ? (
          <Form
            method="get"
            className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md"
            onSubmit={(event) => {
              if (composing || !canSearch) event.preventDefault();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                name="q"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={(event) => {
                  setInput(event.currentTarget.value);
                  setComposing(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeSearch();
                }}
                className="pl-8"
                placeholder="그룹 이름을 두 글자 이상 입력…"
                aria-label="그룹 이름"
                autoComplete="off"
              />
            </div>
            {includeJoined ? (
              <input type="hidden" name="includeJoined" value="true" />
            ) : null}
            <Button type="submit" size="sm" disabled={!canSearch || composing}>
              검색
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="검색 닫기"
              onClick={closeSearch}
            >
              <XIcon />
            </Button>
          </Form>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="그룹 검색"
            onClick={openSearch}
          >
            <SearchIcon />
          </Button>
        )}

        <Field orientation="horizontal" className="w-full sm:ml-auto sm:w-auto">
          <Checkbox
            id="include-joined"
            checked={includeJoined}
            onCheckedChange={(checked) => changeJoinedFilter(checked === true)}
          />
          <FieldLabel
            htmlFor="include-joined"
            className="font-normal text-muted-foreground"
          >
            가입한 그룹도 표시
          </FieldLabel>
        </Field>
      </div>

      {groups.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:hidden">
            {groups.map((group) => (
              <GroupMobileDiscoverCard
                key={group.group_id}
                group={group}
                profileId={profileId}
              />
            ))}
          </div>
          <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <GroupSummaryCard
                key={group.group_id}
                group={group}
                profileId={profileId}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          <p>
            {query
              ? `“${query}”와 맞는 그룹이 없습니다.`
              : "가입할 수 있는 공개 그룹이 없습니다."}
          </p>
          {query ? <p>검색어를 바꿔 다시 찾아보세요.</p> : null}
        </div>
      )}

      {nextCursor || pending ? (
        <div
          ref={sentinelRef}
          className="flex h-12 items-center justify-center"
          aria-live="polite"
        >
          {pending ? <Spinner aria-label="그룹 더 불러오는 중" /> : null}
        </div>
      ) : null}
    </div>
  );
}
