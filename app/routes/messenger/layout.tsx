import { Outlet } from "react-router";

import { AppHeader } from "~/features/app-shell";

export default function MessengerLayout() {
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
      <AppHeader className="max-md:hidden" />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
