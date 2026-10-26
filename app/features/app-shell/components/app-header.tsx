import {
  LogOutIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";
import { Link } from "react-router";
import { useRef, useState } from "react";

import { useAppShell } from "~/features/app-shell/context/app-shell-context";
import { useHomeReselectClick } from "~/features/app-shell/hooks/use-home-reselect-click";
import { LogoutDialog } from "~/features/auth/components/logout-button";
import { GlobalSearchDropdown } from "~/features/search";
import { UserAvatar } from "~/shared/components/user-avatar";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { cn } from "~/shared/lib/utils";

/**
 * 데스크톱 전역 헤더. 모바일은 셸이 숨기고 각 페이지가 `<PageHeader>`를 그린다.
 * `fixed`가 아니라 셸의 flex 흐름 안에 있어 콘텐츠 패딩 보정이 없고 safe-area 상단도 여기서만 처리한다.
 * 로고는 사이드바의 홈과 같다. 홈에서 다시 누르면 이동하지 않고 `onHomeReselect`를 부른다.
 */
export function AppHeader({
  className,
  onHomeReselect,
}: {
  className?: string;
  onHomeReselect: () => void;
}) {
  const onHomeClick = useHomeReselectClick(onHomeReselect);
  const t = useT();
  const { profile } = useAppShell();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const avatarRef = useRef<HTMLButtonElement>(null);

  return (
    <header
      className={cn(
        "z-20 flex h-[var(--app-header-h)] shrink-0 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur",
        className,
      )}
    >
      {/* 양옆 `flex-1 basis-0`으로 검색창을 헤더 정중앙에 둔다. */}
      <div className="flex flex-1 basis-0 items-center">
        <Link
          to="/"
          onClick={onHomeClick}
          className="text-sm font-semibold tracking-wide whitespace-nowrap hover:text-primary"
        >
          KMLA Online
        </Link>
      </div>

      <GlobalSearchDropdown />

      <div className="flex flex-1 basis-0 items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            ref={avatarRef}
            aria-label={t("계정 메뉴")}
            render={<Button variant={null} size="icon" />}
          >
            <UserAvatar src={profile.avatar_url} name={profile.name} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to="/profile" />}>
                <UserRoundIcon aria-hidden />
                {t("내 프로필")}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link to="/settings" />}>
                <SettingsIcon aria-hidden />
                {t("설정")}
              </DropdownMenuItem>
              {profile.role === "admin" ? (
                <DropdownMenuItem render={<Link to="/admin" />}>
                  <ShieldCheckIcon aria-hidden />
                  {t("관리자 페이지")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setLogoutOpen(true)}
              >
                <LogOutIcon aria-hidden />
                {t("로그아웃")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <LogoutDialog
          open={logoutOpen}
          onOpenChange={setLogoutOpen}
          finalFocus={avatarRef}
        />
      </div>
    </header>
  );
}
