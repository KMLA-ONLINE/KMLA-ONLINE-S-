import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";

import { useHideOnScroll } from "~/shared/hooks/use-hide-on-scroll";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  /** 뒤로가기 버튼. 드릴인 화면(그룹 상세, 프로필)에서 쓴다. */
  back?: boolean | string;
  /** 오른쪽 액션 슬롯. 검색·더보기 등. */
  actions?: ReactNode;
  /** 아래로 읽으면 숨긴다. 긴 목록에서만 켠다. 효과는 모바일에서만 보인다. */
  hideOnScroll?: boolean;
  className?: string;
}

/**
 * 페이지가 자기 스크롤 컨테이너 안에 직접 그리는 sticky 헤더.
 *
 * 모바일 헤더를 셸이 아니라 페이지가 소유한다. 그래서 화면마다 다른 제목·뒤로가기·액션이
 * 자연스럽게 들어가고, 셸에 `showMobileHeader` 같은 축이 생기지 않는다.
 *
 * `sticky`는 부모 스크롤 컨테이너(`ScrollRegion`)를 기준으로 붙는다 — `fixed`가 아니므로
 * z-index 싸움도 없고 콘텐츠 상단 패딩 보정도 없다.
 */
export function PageHeader({
  title,
  back,
  actions,
  hideOnScroll = false,
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();
  const hidden = useHideOnScroll({ enabled: hideOnScroll });

  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] items-center gap-2 border-b bg-background/95 px-3 pt-[var(--app-safe-t)] backdrop-blur md:hidden",
        hideOnScroll &&
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
        // 숨김은 모바일에서만. 이 헤더 자체가 md:hidden이라 어차피 데스크톱에선 안 보이지만,
        // 조건을 클래스 한 줄로 두면 JS 미디어 쿼리가 필요 없다.
        hideOnScroll && hidden && "max-md:-translate-y-full",
        className,
      )}
    >
      {back ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="뒤로"
          className="-ml-1 shrink-0"
          onClick={() =>
            typeof back === "string" ? void navigate(back) : void navigate(-1)
          }
        >
          <ChevronLeftIcon />
        </Button>
      ) : null}

      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
        {title}
      </h1>

      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </header>
  );
}
