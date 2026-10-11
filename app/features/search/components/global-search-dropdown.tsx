import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { DirectorySearchPanel } from "~/features/search/components/directory-search-panel";
import { searchDirectory } from "~/features/search/data/queries";
import {
  hasMinimumSearchLength,
  normalizeSearchInput,
} from "~/features/search/model/format";
import type { DirectorySearchResult } from "~/features/search/model/types";
import { Input } from "~/shared/ui/input";

interface SettledSearch {
  query: string;
  result: DirectorySearchResult;
  error: string | null;
}

export function GlobalSearchDropdown() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [composing, setComposing] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [settled, setSettled] = useState<SettledSearch | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    setInput("");
    setSubmittedQuery("");
    setSettled(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (composing) return;
    const normalized = normalizeSearchInput(input);
    if (!hasMinimumSearchLength(normalized)) return;
    setSubmittedQuery(normalized);
  }

  const current = settled?.query === submittedQuery ? settled : null;
  const loading = submittedQuery !== "" && current === null;

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <form onSubmit={submit}>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setInput(event.currentTarget.value);
            setComposing(false);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          className="h-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
          placeholder="사람 · 그룹 검색"
          aria-label="사람 · 그룹 검색"
          autoComplete="off"
          type="search"
        />
      </form>

      {open ? (
        <div className="absolute top-full left-0 z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
          <DirectorySearchPanel
            query={current?.query ?? (loading ? submittedQuery : "")}
            loading={loading}
            result={current?.result ?? null}
            error={current?.error ?? null}
            onNavigate={close}
          />
        </div>
      ) : null}
    </div>
  );
}
