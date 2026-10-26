import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withdrawAccount: vi.fn(),
  listMyOwnedGroups: vi.fn(),
}));

import type * as AuthFeature from "~/features/auth";

vi.mock("~/features/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthFeature>()),
  ...mocks,
}));

import {
  AppShellProvider,
  type ProfileRole,
  type ShellData,
} from "~/features/app-shell";
import WithdrawPage, { clientAction } from "~/routes/app/menu/withdraw";
import { renderRoute, screen } from "../../../router";

function postRequest(entries: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return new Request("http://localhost/settings/withdraw", {
    method: "POST",
    body: form,
  });
}

interface ActionPayload {
  errors: Record<string, string | undefined>;
}

async function payload(result: unknown): Promise<ActionPayload> {
  return (await (result as Promise<{ data: ActionPayload }>)).data;
}

describe("account withdrawal action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires the acknowledgement and the password before calling the server", async () => {
    const result = await payload(
      clientAction({ request: postRequest({}) } as never),
    );

    expect(result.errors).toEqual({
      confirm: "안내를 확인했다고 체크해 주세요.",
      password: "비밀번호를 입력해 주세요.",
    });
    expect(mocks.withdrawAccount).not.toHaveBeenCalled();
  });

  it("shows a wrong password on the password field", async () => {
    mocks.withdrawAccount.mockRejectedValueOnce({
      code: "invalid_credentials",
    });

    const result = await payload(
      clientAction({
        request: postRequest({ confirm: "on", password: "wrong-pass" }),
      } as never),
    );

    expect(mocks.withdrawAccount).toHaveBeenCalledWith("wrong-pass");
    expect(result.errors).toEqual({
      password: "비밀번호가 올바르지 않습니다.",
    });
  });

  it("shows a server-side refusal on the form", async () => {
    mocks.withdrawAccount.mockRejectedValueOnce({
      code: "55000",
      message: "group ownership must be transferred before withdrawal",
      hint: "group_owner",
    });

    const result = await payload(
      clientAction({
        request: postRequest({ confirm: "on", password: "correct-pass" }),
      } as never),
    );

    expect(result.errors).toEqual({
      form: "소유한 그룹이 있어 탈퇴할 수 없습니다. 먼저 소유권을 넘겨 주세요.",
    });
  });

  it("sends the withdrawn person to the login screen with a completion notice", async () => {
    mocks.withdrawAccount.mockResolvedValueOnce(undefined);

    const response = await clientAction({
      request: postRequest({ confirm: "on", password: "correct-pass" }),
    } as never).catch((thrown: unknown) => thrown);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe(
      "/login?withdrawn=1",
    );
  });
});

function renderWithdraw(role: ProfileRole = "member") {
  const shell = {
    email: "student@kmla.hs.kr",
    profile: {
      id: 1,
      pub_id: "student",
      name: "홍길동",
      role,
      type: "student",
      status: "accepted",
      avatar_path: null,
      terms_agreed_at: "2026-10-20T00:00:00+00:00",
    },
  } satisfies ShellData;
  return renderRoute(
    () => (
      <AppShellProvider value={shell}>
        <WithdrawPage
          loaderData={{ ownedGroups: [] }}
          actionData={undefined}
          params={{}}
          matches={[] as never}
        />
      </AppShellProvider>
    ),
    { path: "/settings/withdraw" },
  );
}

describe("account withdrawal screen", () => {
  afterEach(() => window.localStorage.clear());

  it("shows the screen in English when the language is English", async () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    const { user } = renderWithdraw();

    expect(
      (await screen.findAllByRole("heading", { name: "Delete account" }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Deleting your account cannot be undone."),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", {
        name: "I have read the above and agree to delete my account.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();

    // 비밀번호는 `required`라 비워 두면 브라우저가 제출을 막는다. 체크만 빼고 낸다.
    await user.type(screen.getByLabelText("Current password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "Delete account" }));

    expect(
      await screen.findByText("Please check that you have read the notice."),
    ).toBeVisible();
  });

  it("warns an admin in English that they must hand over first", async () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderWithdraw("admin");

    expect(
      await screen.findByRole("heading", {
        name: "Finish these before deleting your account",
      }),
    ).toBeVisible();
  });
});
