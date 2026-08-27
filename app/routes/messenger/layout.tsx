import { Outlet, useMatch } from "react-router";

import { AppHeader, AppSidebar, MobileTabBar } from "~/features/app-shell";

export default function MessengerLayout() {
  const roomMatch = useMatch("/messenger/:roomId");

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
      <AppHeader className="max-md:hidden" />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar className="max-md:hidden" />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </div>

          {roomMatch ? null : <MobileTabBar className="md:hidden" />}
        </div>
      </div>
    </div>
  );
}
