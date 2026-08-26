import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InstallPrompt } from "~/shared/components/install-prompt";
import type { InstallPromptState } from "~/shared/hooks/use-install-prompt";

const useInstallPrompt = vi.hoisted(() => vi.fn());

vi.mock("~/shared/hooks/use-install-prompt", () => ({ useInstallPrompt }));

/**
 * 잠금이 풀린 버튼을 돌려준다.
 *
 * `interactionLockMs`가 0이라도 타이머가 한 틱은 지나야 풀린다. 잠금 자체를 확인하는
 * 테스트는 아래에서 따로 긴 잠금을 넘긴다.
 */
async function enabledButton(name: string) {
  const button = screen.getByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

function renderWith(
  state: Partial<InstallPromptState>,
  { interactionLockMs = 0 }: { interactionLockMs?: number } = {},
) {
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

  render(<InstallPrompt interactionLockMs={interactionLockMs} />);

  return { dismiss, dismissForSession, install, markInstalled, neverShow };
}

describe("InstallPrompt", () => {
  it("install 모드에서는 설치 버튼을 눌러 브라우저 프롬프트를 띄운다", async () => {
    const { install } = renderWith({ mode: "install" });

    await userEvent.click(await enabledButton("설치하기"));

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

  /**
   * 설치가 막힌 브라우저에서 「설치완료」를 보여 주면, 할 수 없다고 안내해 놓고 완료를
   * 묻는 꼴이 된다. 눌러도 정작 설치할 브라우저가 아닌 이곳의 기록만 바뀐다.
   */
  it("iOS 인앱 브라우저 모드에서는 Safari로 옮기라고 안내하고 설치완료를 숨긴다", async () => {
    renderWith({ mode: "ios-other" });

    expect(
      screen.getByRole("heading", { name: /Safari에서 열어/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "설치완료" }),
    ).not.toBeInTheDocument();
    await enabledButton("알겠어요");
  });

  it("android-help 모드에서는 브라우저 메뉴 절차를 안내한다", () => {
    renderWith({ mode: "android-help" });

    expect(screen.getByText(/브라우저 메뉴를 여세요/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "설치하기" }),
    ).not.toBeInTheDocument();
    // 여기서는 설치가 되므로 완료를 물어도 된다.
    expect(
      screen.getByRole("button", { name: "설치완료" }),
    ).toBeInTheDocument();
  });

  it("android-other 모드에서는 Chrome으로 옮기라고 안내하고 설치완료를 숨긴다", async () => {
    const { dismiss } = renderWith({ mode: "android-other" });

    expect(
      screen.getByRole("heading", { name: /Chrome에서 열어/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/외부 브라우저에서 열기/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "설치하기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "설치완료" }),
    ).not.toBeInTheDocument();

    // 남는 버튼은 하나뿐이라 「나중에」가 아니라 확인 문구로 읽혀야 한다.
    await userEvent.click(await enabledButton("알겠어요"));
    expect(dismiss).toHaveBeenCalledOnce();
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

    await userEvent.click(await enabledButton("나중에"));

    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("수동 안내에서는 설치 완료를 직접 기록할 수 있다", async () => {
    const { markInstalled } = renderWith({ mode: "ios-browser" });

    await userEvent.click(await enabledButton("설치완료"));

    expect(markInstalled).toHaveBeenCalledOnce();
  });

  /**
   * 이 안내는 사용자가 화면을 쓰던 도중 스스로 뜬다. 누르던 손가락이 그대로 내려앉아
   * 「나중에」를 눌러 버리면 읽을 새도 없이 사라진다.
   */
  it("뜬 직후에는 버튼이 잠겨 있다", () => {
    renderWith({ mode: "android-help" }, { interactionLockMs: 10_000 });

    expect(screen.getByRole("button", { name: "나중에" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "설치완료" })).toBeDisabled();
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
