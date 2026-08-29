import { SearchIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import { DirectorySearchPanel } from "~/features/search/components/directory-search-panel";
import { searchDirectory } from "~/features/search/data/queries";
import { useDirectorySearchDialog } from "~/features/search/hooks/use-directory-search-dialog";
import {
  hasMinimumSearchLength,
  normalizeSearchInput,
} from "~/features/search/model/format";
import type { DirectorySearchResult } from "~/features/search/model/types";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";

const DIALOG_CLASS =
  "flex h-svh w-full max-w-full sm:max-w-full flex-col gap-0 overflow-hidden rounded-none bg-background p-0 ring-0 top-0 left-0 translate-x-0 translate-y-0";

interface SettledSearch {
  query: string;
  result: DirectorySearchResult;
  error: string | null;
}

/** 모바일 전용 진입점(홈 헤더의 검색 아이콘)에서만 연다. 데스크톱은
 * `GlobalSearchDropdown`을 쓰므로 이 dialog는 데스크톱에서 열리지 않는다. */
export function GlobalSearchDialog() {
  const { open, submittedQuery, closeSearch, submitQuery } =
    useDirectorySearchDialog();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeSearch()}>
      <DialogContent
        showCloseButton={false}
        className={DIALOG_CLASS}
        {...(submittedQuery ? {} : { initialFocus: inputRef })}
      >
        <SearchPanel
          submittedQuery={submittedQuery}
          inputRef={inputRef}
          onSubmitQuery={submitQuery}
          onClose={closeSearch}
        />
      </DialogContent>
    </Dialog>
  );
}

function SearchPanel({
  submittedQuery,
  inputRef,
  onSubmitQuery,
  onClose,
}: {
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
        const result = await searchDirectory(submittedQuery);
        if (current) setSettled({ query: submittedQuery, result, error: null });
      } catch {
        if (current)
          setSettled({
            query: submittedQuery,
            result: { people: [], groups: [] },
            error: "검색 결과를 불러오지 못했습니다.",
          });
      }
    })();

    return () => {
      current = false;
    };
  }, [submittedQuery]);

  const current = settled?.query === submittedQuery ? settled : null;
  const loading = submittedQuery !== "" && current === null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (composing) return;
    const normalized = normalizeSearchInput(query);
    if (!hasMinimumSearchLength(normalized)) return;
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
              placeholder="사람 · 그룹 검색"
              aria-label="사람 · 그룹 검색어"
              className="h-9 rounded-full border-0 bg-muted pl-9 shadow-none [&::-webkit-search-cancel-button]:appearance-none"
              type="search"
            />
          </div>
        </form>
        <DialogTitle className="sr-only">전역 검색</DialogTitle>
        <DialogDescription className="sr-only">
          사람과 그룹을 이름으로 검색합니다.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DirectorySearchPanel
          query={submittedQuery}
          loading={loading}
          result={current?.result ?? null}
          error={current?.error ?? null}
        />
      </div>
    </>
  );
}
