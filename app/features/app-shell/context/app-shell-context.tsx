import { useQuery } from "@tanstack/react-query";
import { createContext, use, type ReactNode } from "react";

import type { ShellData } from "~/features/app-shell/model/types";
// 배럴이 아니라 모듈을 직접 가져온다. `~/features/notifications`의 컴포넌트가 이 파일을
// 다시 참조하므로 배럴로 들어가면 순환이 된다.
import { notificationBadgeQuery } from "~/features/notifications/data/cache";

const AppShellContext = createContext<ShellData | null>(null);

export function AppShellProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ShellData;
}) {
  return <AppShellContext value={value}>{children}</AppShellContext>;
}

export function useAppShell(): ShellData {
  const value = use(AppShellContext);

  if (!value) {
    throw new Error("useAppShell()은 앱 셸 아래에서만 쓸 수 있습니다.");
  }

  return value;
}

/** 경로별 안 읽은 수. 게이트 로더가 아니라 쿼리에서 읽어 `notificationKeys.badge()` 하나만 무효화하면 된다. */
export function useNavBadges(): Record<string, number> {
  const { data } = useQuery(notificationBadgeQuery());

  return { "/noti": data ?? 0 };
}
