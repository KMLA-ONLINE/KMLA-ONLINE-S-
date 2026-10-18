import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createContext, use, useMemo, type ReactNode } from "react";

import {
  shellAvatarQuery,
  shellProfileQuery,
} from "~/features/app-shell/data/queries";
import type {
  AppShellValue,
  ShellData,
} from "~/features/app-shell/model/types";
// 배럴이 아니라 모듈을 직접 가져온다. `~/features/notifications`의 컴포넌트가 이 파일을
// 다시 참조하므로 배럴로 들어가면 순환이 된다.
import { notificationBadgeQuery } from "~/features/notifications/data/cache";
import { unreadMessageCountQuery } from "~/features/messaging/data/cache";

const AppShellContext = createContext<AppShellValue | null>(null);

/** 아바타 서명은 게이트를 막지 않는다. 서명되는 동안 아바타는 이름 첫 글자로 그려진다. */
export function AppShellProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ShellData;
}) {
  // 게이트가 넣은 값에서 시작해 `refreshShellProfile()` 뒤의 새 값을 따른다. 다시 읽은 결과에 승인된
  // 프로필이 없으면(로그아웃 중 등) 게이트 값을 그대로 둔다. redirect는 다음 게이트 진입이 맡는다.
  const { data: fresh } = useQuery({
    ...shellProfileQuery(),
    initialData: value,
  });
  const shellData = useMemo<ShellData>(
    () =>
      fresh?.profile?.status === "accepted"
        ? { email: fresh.email, profile: fresh.profile }
        : value,
    [fresh, value],
  );

  // 사진을 바꾸면 키가 새 경로로 바뀐다. 새 URL이 서명될 때까지 이전 사진을 둬야 셸 전체의 아바타가
  // 이름 첫 글자로 깜빡이지 않는다. 사진을 지웠으면 경로가 `null`이라 곧바로 첫 글자가 맞다.
  const { data: avatarUrl = null } = useQuery({
    ...shellAvatarQuery(shellData.profile.avatar_path),
    placeholderData: shellData.profile.avatar_path
      ? keepPreviousData
      : undefined,
  });
  const shell = useMemo<AppShellValue>(
    () => ({
      ...shellData,
      profile: { ...shellData.profile, avatar_url: avatarUrl },
    }),
    [shellData, avatarUrl],
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

/** 셸이 보여 주는 안 읽은 수. 알림과 메시지는 따로 센다(기능 명세 §13.17). */
export interface UnreadCounts {
  notifications: number;
  messages: number;
  /** 둘 중 하나라도 첫 응답 전이다. 실패한 쪽은 0으로 센다. */
  pending: boolean;
}

/** 사이드바·하단 nav와 같은 쿼리 키를 읽으므로 셸 곳곳에서 불러도 요청은 늘지 않는다. */
export function useUnreadCounts(): UnreadCounts {
  const notifications = useQuery(notificationBadgeQuery());
  const messages = useQuery(unreadMessageCountQuery());

  return {
    notifications: notifications.data ?? 0,
    messages: messages.data ?? 0,
    pending: notifications.isPending || messages.isPending,
  };
}

/** 경로별 안 읽은 수. 게이트 로더가 아니라 쿼리에서 읽어 `notificationKeys.badge()` 하나만 무효화하면 된다. */
export function useNavBadges(): Record<string, number> {
  const { notifications, messages } = useUnreadCounts();

  return { "/noti": notifications, "/messenger": messages };
}
