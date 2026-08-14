import { ArrowLeftIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { GroupPostSearchDialog } from "~/features/posts";
import { useHideOnScroll } from "~/shared/hooks/use-hide-on-scroll";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";

export function GroupDetailMobileHeader({
  name,
  iconPath,
  groupId,
  slug,
  canSearch,
}: {
  name: string;
  iconPath: string | null;
  groupId: string;
  slug: string;
  canSearch: boolean;
}) {
  const navigate = useNavigate();
  const hidden = useHideOnScroll();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <header
        data-slot="group-detail-mobile-header"
        className={cn(
          "sticky top-0 z-10 flex h-[calc(2.75rem+var(--app-safe-t))] items-center gap-2 border-b bg-background/95 px-1.5 pt-[var(--app-safe-t)] backdrop-blur transition-transform duration-200 ease-out motion-reduce:transition-none md:hidden",
          hidden && "-translate-y-full",
        )}
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
            onClick={() => setSearchOpen(true)}
          >
            <SearchIcon aria-hidden="true" />
          </Button>
        ) : null}
      </header>

      <GroupPostSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        groupId={groupId}
        slug={slug}
      />
    </>
  );
}
