import { beforeEach, describe, expect, it, vi } from "vitest";

const { agreeToTerms } = vi.hoisted(() => ({ agreeToTerms: vi.fn() }));

vi.mock("~/features/auth/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agreeToTerms,
}));

vi.mock("~/features/notifications/data/push", () => ({
  enableWebPush: vi.fn(),
  getPushSupport: vi.fn().mockResolvedValue({
    state: "available",
    permission: "default",
    subscribed: false,
  }),
}));

import { TermsAgreementDialog } from "~/features/auth/components/terms-agreement-dialog";
import { NotificationPermissionPrompt } from "~/features/notifications/components/notification-permission-prompt";
import { TERMS_VERSION } from "~/features/auth/model/terms";
import privacyNotice from "../../../../docs/legal/privacy_notice.md?raw";
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
    window.localStorage.clear();
    agreeToTerms.mockResolvedValue(undefined);
  });

  it("records the agreement only after the terms are checked", async () => {
    const { user, onAgreed } = renderDialog();

    const proceed = await screen.findByRole("button", { name: "계속하기" });
    expect(proceed).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /이용약관/ }));
    await user.click(proceed);

    expect(agreeToTerms).toHaveBeenCalledWith(TERMS_VERSION);
    expect(onAgreed).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  // 문구는 docs/legal/privacy_notice.md 2항이 소유한다.
  it("shows the notice worded in the privacy notice document", async () => {
    renderDialog();
    const section = privacyNotice.split(/^## 2\. .*$/m)[1];
    const [, title, body] = /^### (.+)\n\n(.+)$/m.exec(section)!;

    expect(
      await screen.findByRole("heading", { name: title }),
    ).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
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

  // 셸은 약관 팝업과 알림 권한 안내를 함께 마운트한다. 둘이 겹치면 모달 두 개가 포커스를 다툰다.
  it("holds back the notification prompt until the terms are agreed", async () => {
    const { user } = renderRoute(() => (
      <>
        <TermsAgreementDialog open onAgreed={vi.fn()} />
        <NotificationPermissionPrompt profileId={42} />
      </>
    ));

    await user.click(await screen.findByRole("checkbox", { name: /이용약관/ }));
    expect(screen.queryByText("알림을 켜시겠어요?")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "계속하기" }));
    expect(await screen.findByText("알림을 켜시겠어요?")).toBeInTheDocument();
  });
});
