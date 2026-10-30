import { SearchIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";

import {
  EMOJI_GROUPS,
  searchEmojis,
  type EmojiEntry,
} from "~/shared/lib/emoji/search";
import { cn } from "~/shared/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";

/** 검색 결과 상한. 한 글자 검색어는 수백 개가 걸리는데 그만큼 다 그릴 필요는 없다. */
const SEARCH_RESULT_LIMIT = 120;

/**
 * 이모지 전체에서 하나를 고르는 창. 분류 탭과 한글 이름·태그 검색이 있고, 이모지는 기기 기본 글꼴로
 * 그린다. 피부색 변형은 목록에 없다 — 기본 모양만 고른다.
 *
 * 목록 데이터가 200KB라 이 모듈은 `lazy()`로 불러온다. 여는 쪽이 그 책임을 진다.
 */
export function EmojiPicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (emoji: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(EMOJI_GROUPS[0].id);
  // 타자를 치는 동안 1,900개 목록 필터링이 입력을 막지 않게 한 박자 늦춘다.
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim() !== "";
  const entries = searching
    ? searchEmojis(deferredQuery).slice(0, SEARCH_RESULT_LIMIT)
    : searchEmojis("", group);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(28rem,85dvh)] flex-col gap-3 p-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>이모지 선택</DialogTitle>
          <DialogDescription className="sr-only">
            반응으로 남길 이모지를 고릅니다.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="이모지 검색"
            aria-label="이모지 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
          />
        </div>
        {searching ? null : (
          <div
            role="group"
            aria-label="이모지 분류"
            className="flex [scrollbar-width:none] gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
          >
            {EMOJI_GROUPS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-pressed={item.id === group}
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md text-xl",
                  item.id === group ? "bg-muted" : "hover:bg-muted/60",
                )}
                onClick={() => setGroup(item.id)}
              >
                {GROUP_ICONS[item.id] ?? "🔣"}
              </button>
            ))}
          </div>
        )}
        <EmojiGrid
          // 분류를 바꾸거나 검색을 지우면 처음부터 보이게 목록을 새로 만든다 — 스크롤 위치가 남지 않게.
          key={searching ? "search" : group}
          entries={entries}
          emptyLabel={
            searching
              ? `“${deferredQuery.trim()}”에 맞는 이모지가 없습니다.`
              : ""
          }
          onSelect={onSelect}
        />
      </DialogContent>
    </Dialog>
  );
}

/** 분류 탭에 쓰는 대표 이모지. 데이터의 분류 번호(emojibase group)와 같다. */
const GROUP_ICONS: Record<number, string> = {
  0: "😀",
  1: "👋",
  3: "🐻",
  4: "🍔",
  5: "🚗",
  6: "⚽",
  7: "💡",
  8: "❤️",
  9: "🏳️",
};

function EmojiGrid({
  entries,
  emptyLabel,
  onSelect,
}: {
  entries: readonly EmojiEntry[];
  emptyLabel: string;
  onSelect: (emoji: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <p className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
      <div className="grid grid-cols-7 gap-0.5">
        {entries.map((entry) => (
          <button
            key={entry.emoji}
            type="button"
            aria-label={entry.label}
            title={entry.label}
            className="flex aspect-square items-center justify-center rounded-md text-2xl hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => onSelect(entry.emoji)}
          >
            {entry.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
