import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// 셸의 실시간 동기화는 이 테스트와 관계없고 Supabase를 부른다.
vi.mock("~/features/messaging", () => ({ MessagingSync: () => null }));
vi.mock("~/features/notifications/components/notification-sync", () => ({
  NotificationSync: () => null,
}));
vi.mock(
  "~/features/notifications/components/notification-permission-prompt",
  () => ({ NotificationPermissionPrompt: () => null }),
);
vi.mock("~/features/app-shell", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  UnreadBadgeSync: () => null,
}));

import { appShellKeys, type ShellData } from "~/features/app-shell";
import Shell from "~/routes/app/gate";
import { renderRoute, screen } from "../../router";

const shell = {
  email: "student@kmla.hs.kr",
  profile: {
    id: 1,
    pub_id: "student",
    name: "홍길동",
    role: "member",
    type: "student",
    status: "accepted",
    avatar_path: null,
    terms_agreed_at: null,
  },
} satisfies ShellData;

describe("app shell terms agreement", () => {
  // 게이트 loader는 첫 진입에만 돈다. 동의 기록은 셸 프로필 쿼리로 들어오므로 팝업도 그것을 따라야
  // 셸이 다시 마운트됐을 때 이미 동의한 회원에게 다시 뜨지 않는다.
  it("follows the agreement recorded in the shell profile", async () => {
    const { queryClient } = renderRoute(() => (
      <Shell
        {...({ loaderData: shell } as unknown as Parameters<typeof Shell>[0])}
      />
    ));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(appShellKeys.profile(), {
        ...shell,
        profile: { ...shell.profile, terms_agreed_at: "2026-10-20T00:00:00Z" },
      });
    });

    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
