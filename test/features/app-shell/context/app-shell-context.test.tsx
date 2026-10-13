import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AppShellProvider,
  appShellKeys,
  type ShellData,
  useAppShell,
} from "~/features/app-shell";
import { renderRoute, screen } from "../../../router";

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
  },
} satisfies ShellData;

function ShellName() {
  const { profile } = useAppShell();
  return (
    <p>
      {profile.name} · {profile.role}
    </p>
  );
}

function renderShell() {
  return renderRoute(() => (
    <AppShellProvider value={shell}>
      <ShellName />
    </AppShellProvider>
  ));
}

describe("AppShellProvider", () => {
  // 게이트는 다시 돌지 않는다. 프로필 수정·역할 변경 뒤의 새 값은 이 쿼리로만 들어온다.
  it("follows the shell profile query after a refresh", async () => {
    const { queryClient } = renderShell();
    expect(await screen.findByText("홍길동 · member")).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(appShellKeys.profile(), {
        ...shell,
        profile: { ...shell.profile, name: "김철수", role: "admin" },
      });
    });

    expect(await screen.findByText("김철수 · admin")).toBeInTheDocument();
  });

  it("keeps the gate value when the refreshed profile is not accepted", async () => {
    const { queryClient } = renderShell();
    await screen.findByText("홍길동 · member");

    act(() => {
      queryClient.setQueryData(appShellKeys.profile(), {
        ...shell,
        profile: { ...shell.profile, name: "김철수", status: "blocked" },
      });
    });

    expect(screen.getByText("홍길동 · member")).toBeInTheDocument();
  });
});
