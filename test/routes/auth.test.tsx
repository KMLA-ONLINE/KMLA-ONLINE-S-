import { describe, expect, it } from "vitest";

import LoginPage from "~/routes/auth/login";
import SignupPage from "~/routes/auth/signup";
import { renderRoute, screen } from "../router";

describe("auth routes", () => {
  it("renders login controls and toggles password visibility", async () => {
    const { user } = renderRoute(LoginPage, { path: "/login" });
    const password = screen.getByLabelText("비밀번호");

    expect(
      screen.getByRole("heading", { name: "다시 만나서 반가워요" }),
    ).toBeVisible();
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "비밀번호 표시하기" }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("renders signup credential fields", () => {
    renderRoute(SignupPage, { path: "/signup" });

    expect(
      screen.getByRole("heading", { name: "KMLA Online 시작하기" }),
    ).toBeVisible();
    expect(screen.getByLabelText("이메일")).toBeRequired();
    expect(screen.getByLabelText("비밀번호 확인")).toBeRequired();
  });
});
