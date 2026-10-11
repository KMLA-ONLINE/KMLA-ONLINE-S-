import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { appUpdate } = vi.hoisted(() => ({
  appUpdate: {
    updateReady: false,
    applyingUpdate: false,
    updateAppliedElsewhere: false,
    checkForUpdate: null as null | (() => Promise<string>),
    applyUpdate: vi.fn(),
  },
}));

vi.mock("~/shared/hooks/use-service-worker", () => ({
  useAppUpdate: () => appUpdate,
}));

import { AppVersionCard } from "~/features/support/components/app-version-card";

afterEach(() => {
  appUpdate.updateReady = false;
  appUpdate.checkForUpdate = null;
  appUpdate.applyUpdate.mockClear();
});

describe("AppVersionCard", () => {
  it("checks on request and says when the app is already current", async () => {
    let resolve: (value: string) => void = () => undefined;
    appUpdate.checkForUpdate = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    render(<AppVersionCard />);

    await user.click(screen.getByRole("button", { name: "지금 확인" }));
    expect(screen.getByRole("button", { name: "확인 중" })).toBeDisabled();

    await act(() => {
      resolve("latest");
      return Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "최신 버전을 사용하고 있습니다.",
    );
  });

  it("applies a waiting update from the card", async () => {
    appUpdate.updateReady = true;
    appUpdate.checkForUpdate = vi.fn();
    const user = userEvent.setup();
    render(<AppVersionCard />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "새 버전이 준비됐습니다.",
    );
    await user.click(screen.getByRole("button", { name: "새로고침" }));

    expect(appUpdate.applyUpdate).toHaveBeenCalledOnce();
  });

  it("does not offer a check where no service worker runs", () => {
    render(<AppVersionCard />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "이 환경에서는 업데이트를 확인할 수 없습니다.",
    );
  });
});
