import { SearchIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link } from "react-router";

import { searchGroupPosts } from "~/features/posts/data/queries";
import { useGroupPostSearch } from "~/features/posts/hooks/use-group-post-search";
import { extractPostPlainText } from "~/features/posts/model/markdown";
import type { GroupPostSearchResult } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
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

/**
 * 모바일에서는 전체화면, 데스크톱에서는 가운데 정렬된 dialog.
 *
 * `max-md:*`가 하는 일은 Base UI의 기본 위치 지정(가운데로 translate)을 되돌리는 것이다.
 * `bg-background ring-0`은 vendored `DialogContent`의 `bg-popover`/`ring-1`을 덮는다 —
 * 전체화면 시트에서 팝오버 색과 링은 어울리지 않는다. 높이 단위가 `svh`인 것은 모바일
 * 브라우저의 주소창이 접힐 때 화면이 튀지 않게 하기 위해서다.
 */
const SEARCH_DIALOG_CLASS =
  "flex h-[85svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-lg";

/**
 * 열림 상태와 제출한 검색어는 URL이 들고 있다(`useGroupPostSearch`). 그룹 화면에 이 dialog는
 * 하나만 둔다 — 검색 버튼은 모바일 헤더와 데스크톱 액션 두 곳에 있지만, 같은 URL을 두 곳이
 * 함께 보므로 각자 dialog를 그리면 같은 검색창이 두 장 겹쳐 열린다.
 */
export function GroupPostSearchDialog({
  groupId,
  slug,
}: {
  groupId: string;
  slug: string;
}) {
  const { open, submittedQuery, closeSearch, submitQuery } =
    useGroupPostSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeSearch()}>
      <DialogContent
        showCloseButton={false}
        className={SEARCH_DIALOG_CLASS}
        // 포커스는 Base UI에게 맡긴다. `autoFocus` 속성이나 열릴 때의 `focus()` effect는
        // vendored `DialogContent`가 팝업 컨테이너로 보내는 초기 포커스에 덮인다.
        //
        // 검색어를 들고 열릴 때(게시물에서 뒤로가기로 결과에 돌아온 길)는 넘기지 않아
        // 그 기본 동작에 맡긴다. 그때 보러 온 것은 결과 목록인데, 입력창에 포커스를 주면
        // 모바일 키보드가 그 위로 올라온다. `initialFocus: undefined`를 넘기면 기본값까지
        // 지워져 닫기 버튼에 포커스 링이 붙으므로, 조건부로 spread한다.
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

/** 끝난 검색 한 번. 어느 검색어의 결과인지 함께 들고 있어야 지금 검색어의 것인지 가릴 수 있다. */
interface SettledSearch {
  query: string;
  results: GroupPostSearchResult[];
  error: string | null;
}

/**
 * dialog가 닫히면 Base UI가 이 subtree를 통째로 unmount한다. 검색어와 결과를 손으로 지우는
 * 코드가 없는 건 그래서다 — 다음에 열 때 이 component는 URL이 들고 있는 검색어로 새로
 * 시작한다(기능 명세 §8.9). 뒤로가기로 결과 화면에 돌아온 경우에만 그 검색어가 남아 있다.
 */
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
  const [settled, setSettled] = useState<SettledSearch | null>(null);

  useEffect(() => {
    if (!submittedQuery) return;

    let current = true;
    void (async () => {
      try {
        const results = await searchGroupPosts(groupId, submittedQuery);
        if (current)
          setSettled({ query: submittedQuery, results, error: null });
      } catch {
        if (current)
          setSettled({
            query: submittedQuery,
            results: [],
            error: "검색 결과를 불러오지 못했습니다.",
          });
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
        {/* 검색창 자체가 헤더라서 보이는 제목은 없다. 낭독기에는 따로 알려준다. */}
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
            제목, 내용 또는 작성자 이름으로 검색해 보세요.
          </p>
        ) : current.results.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            &ldquo;{submittedQuery}&rdquo;에 대한 검색 결과가 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70">
            {current.results.map((post) => (
              <li key={post.post_id}>
                {/* 게시물 주소에는 검색 param이 없으므로 이동만으로 검색이 닫힌다. 새 entry라서
                    뒤로가기로 돌아오면 URL에 남은 검색어로 결과가 다시 그려진다. */}
                <Link
                  to={`/groups/${slug}/posts/${post.post_id}`}
                  className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/60"
                >
                  <div className="flex items-center gap-2">
                    {post.category_name ? (
                      <Badge variant="secondary" className="shrink-0">
                        {post.category_name}
                      </Badge>
                    ) : null}
                    <p className="line-clamp-1 text-sm font-medium">
                      {post.title}
                    </p>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {extractPostPlainText(post.body)}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      {post.author_name || post.author_label}
                    </span>
                    <span aria-hidden="true">·</span>
                    <RelativeTime value={post.published_at} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
