import type { ReactNode } from "react";

import { cn } from "~/shared/lib/utils";

export function MessagingScreen({
  children,
  hasRoom,
}: {
  children: ReactNode;
  hasRoom: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "flex w-full min-w-0 flex-col border-r md:w-80 md:shrink-0",
          hasRoom && "max-md:hidden",
        )}
      >
        <header className="flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center border-b px-4 pt-[var(--app-safe-t)] md:pt-0">
          <h1 className="text-base font-semibold">메시지</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 text-sm text-muted-foreground">
          대화방 목록이 들어갑니다.
        </div>
      </div>

      <div
        className={cn(
          "min-w-0 flex-1 flex-col",
          hasRoom ? "flex" : "hidden md:flex",
        )}
      >
        {children}
      </div>
    </>
  );
}
