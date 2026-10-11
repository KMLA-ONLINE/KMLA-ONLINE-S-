import { useQuery } from "@tanstack/react-query";
import { createContext, use, useMemo, type ReactNode } from "react";

import { shellAvatarQuery } from "~/features/app-shell/data/queries";
import type {
  AppShellValue,
  ShellData,
} from "~/features/app-shell/model/types";
// 배럴이 아니라 모듈을 직접 가져온다. `~/features/notifications`의 컴포넌트가 이 파일을
// 다시 참조하므로 배럴로 들어가면 순환이 된다.
import { notificationBadgeQuery } from "~/features/notifications/data/cache";

const AppShellContext = createContext<AppShellValue | null>(null);

/** 아바타 서명은 게이트를 막지 않는다. 서명되는 동안 아바타는 이름 첫 글자로 그려진다. */
export function AppShellProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ShellData;
}) {
  const { data: avatarUrl = null } = useQuery(
    shellAvatarQuery(value.profile.avatar_path),
  );
  const shell = useMemo<AppShellValue>(
    () => ({
      ...value,
      profile: { ...value.profile, avatar_url: avatarUrl },
    }),
    [value, avatarUrl],
  );

  return <AppShellContext value={shell}>{children}</AppShellContext>;
}

export function useAppShell(): AppShellValue {
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
