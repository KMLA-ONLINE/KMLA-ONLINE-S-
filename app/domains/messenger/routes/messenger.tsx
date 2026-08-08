import { Outlet, useParams } from "react-router";

import { cn } from "~/shared/lib/utils";

/**
 * `immersive` 레이아웃 밑에 있는 유일한 화면. 셸은 높이만 잡아 주고 **스크롤은 이 라우트가
 * 직접 소유한다** — 방 목록과 대화창이 각자 자기 영역에서만 스크롤한다.
 *
 * 모바일에서는 방을 열면 목록이 사라지고 대화창이 전체를 차지한다(URL이 곧 화면 상태라
 * 뒤로가기가 그대로 동작한다). 데스크톱에서는 둘이 나란히 있다.
 */
export default function MessengerPage() {
  const { roomId } = useParams();

  return (
    <>
      <div
        className={cn(
          "flex w-full min-w-0 flex-col border-r md:w-80 md:shrink-0",
          roomId && "max-md:hidden",
        )}
      >
        <header className="flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center border-b px-4 pt-[var(--app-safe-t)] md:pt-0">
          <h1 className="text-base font-semibold">메시지</h1>
        </header>

        {/* 목록만 스크롤한다. 페이지 전체가 스크롤하면 안 된다. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 text-sm text-muted-foreground">
          대화방 목록이 들어갑니다.
        </div>
      </div>

      <div
        className={cn(
          "min-w-0 flex-1 flex-col",
          roomId ? "flex" : "hidden md:flex",
        )}
      >
        <Outlet />
      </div>
    </>
  );
}
