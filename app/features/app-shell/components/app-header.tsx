import { MessagesSquareIcon } from "lucide-react";
import { Link } from "react-router";

import { useAppShell } from "~/features/app-shell/context/app-shell-context";
import { GlobalSearchDropdown } from "~/features/search";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";

/**
 * 데스크톱 전역 헤더. 모바일에서는 셸이 통째로 숨기고, 각 페이지가 `<PageHeader>`로 자기 헤더를
 * 그린다 — 그래서 `showMobileHeader` 같은 플래그가 필요 없다.
 *
 * `fixed`가 아니라 셸의 flex 흐름 안에 있다. 아래 콘텐츠가 헤더 높이만큼 패딩을 상쇄할 필요가
 * 없어지고, safe-area 상단도 여기서만 처리한다.
 */
export function AppHeader({ className }: { className?: string }) {
  const { profile } = useAppShell();

  return (
    <header
      className={cn(
        "z-20 flex h-[var(--app-header-h)] shrink-0 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur",
        className,
      )}
    >
      {/* 양옆을 `flex-1 basis-0`으로 두면 로고/액션 폭과 무관하게 남는 공간이 균등하게 나뉘어,
          가운데 검색창이 헤더 정중앙에 놓인다. */}
      <div className="flex flex-1 basis-0 items-center">
        <Link
          to="/"
          className="text-sm font-semibold tracking-wide whitespace-nowrap hover:text-primary"
        >
          KMLA Online
        </Link>
      </div>

      <GlobalSearchDropdown />

      <div className="flex flex-1 basis-0 items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          nativeButton={false}
          aria-label="메시지"
          render={<Link to="/messenger" />}
        >
          <MessagesSquareIcon />
        </Button>
        <Link to="/profile" aria-label="내 프로필">
          <UserAvatar src={profile.avatar_url} name={profile.name} />
        </Link>
      </div>
    </header>
  );
}
