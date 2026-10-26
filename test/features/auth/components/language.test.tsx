import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogoutButton } from "~/features/auth/components/logout-button";
import { TermsAgreementDialog } from "~/features/auth/components/terms-agreement-dialog";
import { renderRoute, screen, within } from "../../../router";

describe("auth components in English", () => {
  beforeEach(() => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
  });

  afterEach(() => window.localStorage.clear());

  it("translates the logout confirmation", async () => {
    const { user } = renderRoute(LogoutButton);

    await user.click(await screen.findByRole("button", { name: "Log out" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Log out?" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Log out" }),
    ).toBeVisible();
  });

  it("translates the existing member terms dialog", async () => {
    renderRoute(() => <TermsAgreementDialog open onAgreed={vi.fn()} />);

    expect(
      await screen.findByRole("heading", {
        name: "The Terms of service and Privacy policy are now in effect",
      }),
    ).toBeVisible();
    expect(screen.getByText(/As of October 20, 2026/)).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /I agree to the Terms of service/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Log out without agreeing" }),
    ).toBeVisible();
  });
});
