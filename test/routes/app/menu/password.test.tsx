import { afterEach, describe, expect, it } from "vitest";

import { AppShellProvider, type ShellData } from "~/features/app-shell";
import MenuPasswordPage from "~/routes/app/menu/password";
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
    terms_agreed_at: "2026-10-20T00:00:00+00:00",
  },
} satisfies ShellData;

function renderPassword(actionData?: unknown) {
  return renderRoute(
    () => (
      <AppShellProvider value={shell}>
        <MenuPasswordPage
          actionData={actionData as never}
          loaderData={undefined}
          params={{}}
          matches={[] as never}
        />
      </AppShellProvider>
    ),
    { path: "/settings/password" },
  );
}

afterEach(() => window.localStorage.clear());

describe("password change screen", () => {
  it("asks for an email verification code first", () => {
    renderPassword();

    expect(
      screen.getAllByRole("heading", { name: "비밀번호 변경" }),
    ).not.toHaveLength(0);
    expect(
      screen.getByText(
        "student@kmla.hs.kr로 인증 코드를 보내 본인을 확인합니다.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "인증 코드 받기" }),
    ).toBeInTheDocument();
  });

  it("shows the screen in English when the language is English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderPassword({ step: "verify", resent: true });

    expect(
      screen.getAllByRole("heading", { name: "Change password" }),
    ).not.toHaveLength(0);
    expect(screen.getByText("Verify your email")).toBeVisible();
    expect(
      screen.getByText("Enter the 6-digit code we sent to student@kmla.hs.kr."),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "We sent the verification code again.",
    );
    expect(screen.getByText("Verification code")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resend verification code" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change password" }),
    ).toBeInTheDocument();
  });

  it("shows the done state in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderPassword({ step: "done" });

    expect(screen.getByText("Your password has been changed")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to settings" }),
    ).toHaveAttribute("href", "/settings");
  });
});
