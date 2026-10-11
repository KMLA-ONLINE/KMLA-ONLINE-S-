import { useRef } from "react";
import { Outlet, useMatch } from "react-router";

import { AppHeader, AppSidebar, MobileTabBar } from "~/features/app-shell";

export default function MessengerLayout() {
  const roomMatch = useMatch("/messenger/:roomId");
  // 메신저는 대화 목록이 자기 스크롤을 가진다. 셸 공통 스크롤 영역이 없어 탭 재탭은 이동만 막는다.
  const scrollRef = useRef<HTMLElement>(null);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
      <AppHeader className="max-md:hidden" />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar className="max-md:hidden" />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </div>

          {roomMatch ? null : (
            <MobileTabBar scrollRef={scrollRef} className="md:hidden" />
          )}
        </div>
      </div>
    </div>
  );
}
