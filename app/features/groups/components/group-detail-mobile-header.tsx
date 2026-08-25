import { ArrowLeftIcon, SearchIcon } from "lucide-react";
import { useNavigate } from "react-router";

import { useGroupPostSearch } from "~/features/posts";
import { Button } from "~/shared/ui/button";

export function GroupDetailMobileHeader({
  name,
  iconPath,
  canSearch,
}: {
  name: string;
  iconPath: string | null;
  canSearch: boolean;
}) {
  const navigate = useNavigate();
  // 검색창은 `GroupDetailScreen`이 하나만 그린다. 여기서는 URL만 연다.
  const { openSearch } = useGroupPostSearch();

  return (
    <header
      data-slot="group-detail-mobile-header"
      className="sticky top-0 z-10 flex h-[calc(2.75rem+var(--app-safe-t))] items-center gap-2 border-b bg-background/95 px-1.5 pt-[var(--app-safe-t)] backdrop-blur md:hidden"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="그룹 목록으로 돌아가기"
        onClick={() => void navigate("/groups")}
      >
        <ArrowLeftIcon />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-sm font-semibold">
          {iconPath ? (
            <img
              src={iconPath}
              alt=""
              width={28}
              height={28}
              className="size-full object-cover"
            />
          ) : (
            name.trim().slice(0, 1)
          )}
        </div>
        <span className="truncate text-base font-semibold">{name}</span>
      </div>

      {canSearch ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="게시물 검색"
          className="focus-visible:border-transparent focus-visible:ring-0"
          onClick={openSearch}
        >
          <SearchIcon aria-hidden="true" />
        </Button>
      ) : null}
    </header>
  );
}
