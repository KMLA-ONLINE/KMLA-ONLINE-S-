import { createContext, use, type ReactNode } from "react";

import type { ShellData } from "~/features/app-shell/model/types";

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

export function useNavBadges(): Record<string, number> {
  return useAppShell().badges;
}
