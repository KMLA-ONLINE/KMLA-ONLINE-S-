import { beforeEach, describe, expect, it, vi } from "vitest";

const { agreeToTerms } = vi.hoisted(() => ({ agreeToTerms: vi.fn() }));

vi.mock("~/features/auth/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agreeToTerms,
}));

import { TermsAgreementDialog } from "~/features/auth/components/terms-agreement-dialog";
import { renderRoute, screen, waitFor } from "../../../router";

function renderDialog(onAgreed = vi.fn()) {
  const view = renderRoute(() => (
    <TermsAgreementDialog open onAgreed={onAgreed} />
  ));
  return { ...view, onAgreed };
}

describe("existing member terms agreement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agreeToTerms.mockResolvedValue(undefined);
  });

  it("records the agreement only after the terms are checked", async () => {
    const { user, onAgreed } = renderDialog();

    const proceed = await screen.findByRole("button", { name: "계속하기" });
    expect(proceed).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /이용약관/ }));
    await user.click(proceed);

    expect(agreeToTerms).toHaveBeenCalledWith("2026-10-20");
    expect(onAgreed).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  // 동의가 필수라 Esc나 바깥 클릭으로 앱에 들어갈 수 없어야 한다.
  it("cannot be dismissed without agreeing", async () => {
    const { user } = renderDialog();
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "동의하지 않고 로그아웃" }),
    ).toBeVisible();
  });

  it("stays open and explains a failed agreement", async () => {
    agreeToTerms.mockRejectedValueOnce(new Error("offline"));
    const { user, onAgreed } = renderDialog();

    await user.click(await screen.findByRole("checkbox", { name: /이용약관/ }));
    await user.click(screen.getByRole("button", { name: "계속하기" }));

    expect(onAgreed).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
