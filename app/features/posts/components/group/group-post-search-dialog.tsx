import { SearchIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link, useNavigation } from "react-router";

import { groupKeys } from "~/features/groups/data/cache";
import { searchGroupPosts } from "~/features/posts/data/queries";
import { useSearchDialogParam } from "~/shared/hooks/use-search-dialog-param";
import { postAuthorName } from "~/features/posts/model/identity";
import { FROM_GROUP, groupPostPath } from "~/features/posts/model/navigation";
import { extractPostPlainText } from "~/features/posts/model/markdown";
import type { GroupPostSearchResult } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { getQueryClient } from "~/shared/lib/query-client";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { cn } from "~/shared/lib/utils";

/** 모바일은 전체화면, 데스크톱은 가운데 dialog. `svh`는 주소창이 접힐 때 화면이 튀지 않게 한다. */
const SEARCH_DIALOG_CLASS =
  "flex h-[85svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-lg";

/** 열림 상태와 검색어는 URL이 들고 있다. 그룹 화면에 dialog는 하나만 둔다 — 버튼이 두 곳이라 각자 그리면 겹쳐 열린다. */
export function GroupPostSearchDialog({
  groupId,
  slug,
}: {
  groupId: string;
  slug: string;
}) {
  const { open, submittedQuery, closeSearch, submitQuery } =
    useSearchDialogParam();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeSearch()}>
      <DialogContent
        showCloseButton={false}
        className={SEARCH_DIALOG_CLASS}
        // 포커스는 Base UI에 맡긴다. `autoFocus`/`focus()` effect는 `DialogContent`의 초기 포커스에 덮인다.
        // 검색어를 들고 열릴 때는 결과 목록을 보러 온 것이라 키보드가 올라오지 않게 기본 동작에 맡긴다.
        // `initialFocus: undefined`는 기본값까지 지워 닫기 버튼에 포커스 링이 붙으므로 조건부로 spread한다.
        {...(submittedQuery ? {} : { initialFocus: inputRef })}
      >
        <SearchPanel
          groupId={groupId}
          slug={slug}
          submittedQuery={submittedQuery}
          inputRef={inputRef}
          onSubmitQuery={submitQuery}
          onClose={closeSearch}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * 검색 결과를 기억해 두되 믿지는 않는다. 결과에서 게시물을 열었다 돌아오면 이 패널이 다시 마운트되는데, 기억한
 * 결과로 첫 화면을 바로 그리고 같은 검색을 뒤에서 다시 돌려 갈아 끼운다. 기억만 쓰면 그사이 올라온 글이나
 * 볼 수 없게 된 글이 반영되지 않는다.
 */
function searchQuery(groupId: string, query: string) {
  return {
    queryKey: groupKeys.postSearch(groupId, query),
    queryFn: () => searchGroupPosts(groupId, query),
    staleTime: 0,
  };
}

/** 끝난 검색 한 번. 어느 검색어의 결과인지 함께 들고 있어야 지금 검색어의 것인지 가릴 수 있다. */
interface SettledSearch {
  query: string;
  results: GroupPostSearchResult[];
  error: string | null;
}

/** 닫히면 subtree가 unmount되어 상태를 지우는 코드가 없다. 다시 열면 URL의 검색어로 시작한다(기능 명세 §8.9). */
function SearchPanel({
  groupId,
  slug,
  submittedQuery,
  inputRef,
  onSubmitQuery,
  onClose,
}: {
  groupId: string;
  slug: string;
  submittedQuery: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmitQuery: (query: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(submittedQuery);
  const [composing, setComposing] = useState(false);
  // 돌아온 길이면 기억해 둔 결과로 첫 화면부터 그린다.
  const [settled, setSettled] = useState<SettledSearch | null>(() => {
    if (!submittedQuery) return null;
    const results = getQueryClient().getQueryData<GroupPostSearchResult[]>(
      groupKeys.postSearch(groupId, submittedQuery),
    );
    return results ? { query: submittedQuery, results, error: null } : null;
  });
  const navigation = useNavigation();
  const openingPath =
    navigation.state === "loading" ? navigation.location.pathname : null;

  useEffect(() => {
    if (!submittedQuery) return;

    let current = true;
    void (async () => {
      try {
        const results = await getQueryClient().fetchQuery(
          searchQuery(groupId, submittedQuery),
        );
        if (current)
          setSettled({ query: submittedQuery, results, error: null });
      } catch {
        if (!current) return;
        // 기억한 결과를 보여주는 중이면 다시 읽기가 실패했다고 지우지 않는다.
        setSettled((previous) =>
          previous?.query === submittedQuery && !previous.error
            ? previous
            : {
                query: submittedQuery,
                results: [],
                error: "검색 결과를 불러오지 못했습니다.",
              },
        );
      }
    })();

    // 검색어가 바뀌면 이전 요청은 버린다. 늦게 도착한 지난 응답이 지금 결과를 덮어쓰지 않는다.
    return () => {
      current = false;
    };
  }, [groupId, submittedQuery]);

  // 무엇을 그릴지는 "끝난 검색이 지금 검색어의 것인가"로 갈린다. 로딩 여부를 따로 state로
  // 들면 effect가 자기 body에서 state를 밀어 넣게 되고, 그만큼 렌더가 한 번 더 돈다.
  const current = settled?.query === submittedQuery ? settled : null;
  const loading = submittedQuery !== "" && current === null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // 한글 조합 중의 Enter는 글자를 확정하는 키다. 여기서 제출하면 "ㄱ"으로 검색된다.
    if (composing) return;

    const normalized = query.normalize("NFC").trim();
    if (!normalized) return;
    onSubmitQuery(normalized);
  };

  return (
    <>
      <DialogHeader className="flex-row items-center gap-2 border-b p-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="검색 닫기"
          onClick={onClose}
        >
          <XIcon />
        </Button>
        <form onSubmit={submit} className="flex-1">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(event) => {
                setQuery(event.currentTarget.value);
                setComposing(false);
              }}
              autoComplete="off"
              placeholder="제목, 내용, 작성자 검색"
              aria-label="게시물 검색어"
              className="h-9 rounded-full border-0 bg-muted pl-9 shadow-none [&::-webkit-search-cancel-button]:appearance-none"
              type="search"
            />
          </div>
        </form>
        {/* 검색창이 헤더라 제목은 낭독기 전용이다. */}
        <DialogTitle className="sr-only">게시물 검색</DialogTitle>
        <DialogDescription className="sr-only">
          이 그룹의 게시물을 제목, 본문 또는 작성자 이름으로 검색합니다.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : current?.error ? (
          <p role="alert" className="p-8 text-center text-sm text-destructive">
            {current.error}
          </p>
        ) : !current ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            제목, 내용 또는 작성자 이름으로 검색...
          </p>
        ) : current.results.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            &ldquo;{submittedQuery}&rdquo;에 대한 검색 결과가 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70">
            {current.results.map((post) => {
              const path = groupPostPath(slug, post.post_id);
              // 그룹 위에 뜨는 상세라 레이아웃이 skeleton을 그리지 않는다. 불러오는 동안 누른 행이 알린다.
              const opening = openingPath === path;
              return (
                <li key={post.post_id}>
                  {/* 게시물 주소엔 검색 param이 없어 이동하면 검색이 닫히고, 뒤로가기로 URL의 검색어가 복원된다. */}
                  <Link
                    to={path}
                    state={FROM_GROUP}
                    aria-busy={opening || undefined}
                    className={cn(
                      "flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/60",
                      opening && "bg-muted/60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {post.category_name ? (
                        <Badge variant="secondary" className="shrink-0">
                          {post.category_name}
                        </Badge>
                      ) : null}
                      <p className="line-clamp-1 min-w-0 flex-1 text-sm font-medium">
                        {post.title}
                      </p>
                      {opening ? <Spinner className="shrink-0" /> : null}
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {extractPostPlainText(post.body)}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{postAuthorName(post)}</span>
                      <span aria-hidden="true">·</span>
                      <RelativeTime value={post.published_at} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
