import { CheckIcon, ChevronLeftIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, useFetcher, useSearchParams } from "react-router";

import { GroupMobileDiscoverCard } from "~/features/groups/components/group-mobile-discover-card";
import { GroupDiscoverCard } from "~/features/groups/components/group-discover-card";
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
}

export function GroupDiscoverScreen({
  initialPage,
  query,
  includeJoined,
  profileId,
  searchOpen,
  focusSearch,
  onSearchOpenChange,
}: {
  initialPage: GroupDiscoveryPage;
  query: string;
  includeJoined: boolean;
  profileId: number;
  searchOpen: boolean;
  focusSearch: boolean;
  onSearchOpenChange: (open: boolean) => void;
}) {
  const [input, setInput] = useState(query);
  const [composing, setComposing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<DiscoveryLoaderData>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    initialPage,
    additionalPages: [],
  });
  const processedData = useRef(fetcher.data);

  useEffect(() => {
    if (!fetcher.data || processedData.current === fetcher.data) return;
    processedData.current = fetcher.data;
    setPagination((current) => ({
      initialPage,
      additionalPages:
        current.initialPage === initialPage
          ? [...current.additionalPages, fetcher.data!.page]
          : [fetcher.data!.page],
    }));
  }, [fetcher.data, initialPage]);

  const pages = [
    initialPage,
    ...(pagination.initialPage === initialPage
      ? pagination.additionalPages
      : []),
  ];
  const groups = pages.flatMap((page) => page.groups);
  const nextCursor = pages.at(-1)?.nextCursor ?? null;

  useEffect(() => {
    if (!searchOpen || !focusSearch) return;
    inputRef.current?.focus();
  }, [focusSearch, searchOpen]);

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
    onSearchOpenChange(true);
  }

  function closeSearch() {
    setInput("");
    onSearchOpenChange(false);
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

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-x-3">
        {searchOpen ? (
          <Form
            method="get"
            className="flex w-full min-w-0 items-center gap-2 md:max-w-md md:flex-1"
            onSubmit={(event) => {
              if (composing || !canSearch) event.preventDefault();
            }}
          >
            <div className="relative min-w-0 flex-1">
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
                className="rounded-full pr-10 md:rounded-md"
                placeholder="그룹 이름을 두 글자 이상 입력…"
                aria-label="그룹 이름"
                autoComplete="off"
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                aria-label="그룹 검색"
                disabled={!canSearch || composing}
              >
                <SearchIcon aria-hidden />
              </Button>
            </div>
            {includeJoined ? (
              <input type="hidden" name="includeJoined" value="true" />
            ) : null}
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
            className="hidden md:inline-flex"
            aria-label="그룹 검색"
            onClick={openSearch}
          >
            <SearchIcon />
          </Button>
        )}

        <Button
          type="button"
          variant={includeJoined ? "default" : "outline"}
          size="sm"
          className="self-end rounded-full md:hidden"
          aria-pressed={includeJoined}
          onClick={() => changeJoinedFilter(!includeJoined)}
        >
          {includeJoined ? (
            <CheckIcon aria-hidden data-icon="inline-start" />
          ) : null}
          {includeJoined ? "가입한 그룹 포함 중" : "가입한 그룹 포함"}
        </Button>

        <Field
          orientation="horizontal"
          className="ml-auto hidden w-auto md:flex"
        >
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
              <GroupDiscoverCard
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
