import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InstallPrompt } from "~/shared/components/install-prompt";
import type { InstallPromptState } from "~/shared/hooks/use-install-prompt";

const useInstallPrompt = vi.hoisted(() => vi.fn());

vi.mock("~/shared/hooks/use-install-prompt", () => ({ useInstallPrompt }));

function renderWith(state: Partial<InstallPromptState>) {
  const install = vi.fn(() => Promise.resolve());
  const dismiss = vi.fn();
  const dismissForSession = vi.fn();
  const neverShow = vi.fn();
  const markInstalled = vi.fn();

  useInstallPrompt.mockReturnValue({
    open: true,
    mode: null,
    confirmingNeverShow: false,
    install,
    dismiss,
    dismissForSession,
    neverShow,
    markInstalled,
    ...state,
  } satisfies InstallPromptState);

  render(<InstallPrompt />);

  return { dismiss, dismissForSession, install, markInstalled, neverShow };
}

describe("InstallPrompt", () => {
  it("install 모드에서는 설치 버튼을 눌러 브라우저 프롬프트를 띄운다", async () => {
    const { install } = renderWith({ mode: "install" });

    await userEvent.click(screen.getByRole("button", { name: "설치하기" }));

    expect(install).toHaveBeenCalledOnce();
  });

  it("iOS 브라우저 모드에서는 설치 버튼 대신 공유 메뉴 절차를 안내한다", () => {
    renderWith({ mode: "ios-browser" });

    expect(
      screen.queryByRole("button", { name: "설치하기" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/공유 버튼/)).toBeInTheDocument();
    expect(screen.getByText(/'홈 화면에 추가'를 선택/)).toBeInTheDocument();
  });

  it("iOS 인앱 브라우저 모드에서는 Safari로 옮기라고 안내한다", () => {
    renderWith({ mode: "ios-other" });

    expect(
      screen.getByRole("heading", { name: /Safari에서 열어/ }),
    ).toBeInTheDocument();
  });

  it("android-help 모드에서는 브라우저 메뉴 절차를 안내한다", () => {
    renderWith({ mode: "android-help" });

    expect(screen.getByText(/브라우저 메뉴를 여세요/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "설치하기" }),
    ).not.toBeInTheDocument();
  });

  it("android-other 모드에서는 Chrome으로 옮기라고 안내한다", () => {
    renderWith({ mode: "android-other" });

    expect(
      screen.getByRole("heading", { name: /Chrome에서 열어/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/다른 브라우저로 열기/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "설치하기" }),
    ).not.toBeInTheDocument();
  });

  it("열릴 때 거절 버튼에 포커스가 가지 않는다", async () => {
    renderWith({ mode: "android-help" });

    // 첫 tabbable 요소로 포커스를 옮기는 Base UI 기본 동작에 걸리면 「나중에」가 잡힌다.
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveFocus();
    });
    expect(screen.getByRole("button", { name: "나중에" })).not.toHaveFocus();
  });

  it("닫기 버튼은 dismiss를 부른다", async () => {
    const { dismiss } = renderWith({ mode: "android-help" });

    await userEvent.click(screen.getByRole("button", { name: "나중에" }));

    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("수동 안내에서는 설치 완료를 직접 기록할 수 있다", async () => {
    const { markInstalled } = renderWith({ mode: "ios-browser" });

    await userEvent.click(screen.getByRole("button", { name: "설치완료" }));

    expect(markInstalled).toHaveBeenCalledOnce();
  });

  it("네 번째 거절 확인 화면에서 영구 숨김을 선택할 수 있다", async () => {
    const { neverShow } = renderWith({
      mode: "install",
      confirmingNeverShow: true,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "다시 보지 않기" }),
    );

    expect(neverShow).toHaveBeenCalledOnce();
  });
});
