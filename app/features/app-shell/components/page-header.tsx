import { ChevronLeftIcon } from "lucide-react";
import { useCallback, type MouseEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { useHideOnScroll } from "~/shared/hooks/use-hide-on-scroll";
import { useScrollToTopOnTap } from "~/shared/hooks/use-scroll-to-top-on-tap";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  /**
   * 문자열이면 그 경로로, `true`는 `{ fallback: "/" }`와 같다. `{ fallback }`은 이전 화면으로 가되 없으면 그 경로로 바꿔 든다(`useGoBack()`) —
   * 편집·생성 화면처럼 들어온 곳으로 돌아가야 하는 화면이 쓴다. 문자열로 앞으로 보내면 두 화면이 history에 번갈아 쌓여 뒤로가기가 둘 사이를 맴돈다.
   */
  back?: boolean | string | { fallback: string };
  actions?: ReactNode;
  /** 아래로 읽으면 숨긴다. 기본은 고정이고, 긴 목록에서만 켠다. 효과는 모바일에서만 보인다. */
  hideOnScroll?: boolean;
  className?: string;
}

/**
 * 페이지가 자기 스크롤 컨테이너 안에 그리는 sticky 헤더. 모바일 헤더를 셸이 아닌 페이지가 소유해 화면별 제목·액션이 자연스럽다.
 * `fixed`가 아니므로 z-index 싸움도 상단 패딩 보정도 없다.
 */
export function PageHeader({
  title,
  back,
  actions,
  hideOnScroll = false,
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();
  const t = useT();
  const goBack = useGoBack();
  const hidden = useHideOnScroll({ enabled: hideOnScroll });
  const onTap = useScrollToTopOnTap();

  return (
    // 맨 위로 가기는 터치 편의다. 키보드는 스크롤 영역에서 Home 키로 같은 일을 한다.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <header
      onClick={onTap}
      className={cn(
        // 배경은 불투명하다. `bg-background/95 + backdrop-blur`는 아래로 지나가는
        // 사진·카드 색을 그대로 빨아들여, 스크롤하는 동안 헤더 색이 계속 바뀌었다.
        "sticky top-0 z-10 flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] items-center gap-2 bg-background px-3 pt-[var(--app-safe-t)] md:hidden",
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
          aria-label={t("뒤로")}
          className="-ml-1 shrink-0"
          onClick={() => {
            if (typeof back === "string") {
              void navigate(back);
              return;
            }
            goBack(typeof back === "object" ? back.fallback : "/");
          }}
        >
          <ChevronLeftIcon />
        </Button>
      ) : null}

      <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">
        {title}
      </h1>

      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * 이전 화면으로 돌아간다. 링크로 바로 들어와 앱 안의 이전 화면이 없으면 `fallback`으로 지금 자리를 바꾼다 —
 * -1은 앱 밖으로 나가고, 앞으로 보내면 지금 화면이 history에 남아 뒤로가기가 이리로 돌아온다.
 */
export function useGoBack() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (fallback: string) => {
      if (location.key === "default")
        void navigate(fallback, { replace: true });
      else void navigate(-1);
    },
    [location.key, navigate],
  );
}

/** 데스크톱의 돌아가기 링크에 단다. 새 탭·새 창으로 여는 손짓은 브라우저에 맡기고, 그냥 누르면 `useGoBack()`으로 돌아간다. */
export function useBackLinkClick(fallback: string) {
  const goBack = useGoBack();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    goBack(fallback);
  };
}
