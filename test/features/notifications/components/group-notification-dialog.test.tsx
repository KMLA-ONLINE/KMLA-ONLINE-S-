import { act, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { GroupNotificationDialog } from "~/features/notifications/components/group-notification-dialog";
import type { GroupNotificationPreference } from "~/features/notifications/model/types";
import { renderRoute } from "../../../router";

const mocks = vi.hoisted(() => ({
  getMyGroupNotificationPreference: vi.fn(),
  updateGroupNotificationPreferences: vi.fn(),
}));

vi.mock("~/features/notifications/data/queries", () => ({
  getMyGroupNotificationPreference: mocks.getMyGroupNotificationPreference,
}));
vi.mock("~/features/notifications/data/mutations", () => ({
  updateGroupNotificationPreferences: mocks.updateGroupNotificationPreferences,
}));

const preference: GroupNotificationPreference = {
  groupId: "11111111-1111-4111-8111-111111111111",
  groupName: "테스트 그룹",
  groupKind: "official",
  level: "all",
  contentPushEnabled: true,
  newPostPushEnabled: false,
};

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        다시 열기
      </button>
      <GroupNotificationDialog
        groupId={preference.groupId}
        groupName={preference.groupName}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

describe("GroupNotificationDialog", () => {
  it("blocks closing during save and reloads from the server when reopened", async () => {
    let finishSave: (() => void) | null = null;
    let finishReload:
      ((value: GroupNotificationPreference | null) => void) | null = null;
    mocks.getMyGroupNotificationPreference
      .mockResolvedValueOnce(preference)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishReload = resolve;
        }),
      );
    mocks.updateGroupNotificationPreferences.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
    );

    const { user } = renderRoute(Harness);
    const contentSwitch = await screen.findByRole("switch", {
      name: "테스트 그룹 관련 활동 Push",
    });

    await user.click(contentSwitch);
    expect(screen.getByRole("button", { name: "닫기" })).toBeDisabled();

    await act(async () => {
      finishSave?.();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "닫기" })).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: "닫기" }));
    await user.click(screen.getByRole("button", { name: "다시 열기" }));

    expect(
      screen.getByRole("status", { name: "알림 설정 불러오는 중" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "테스트 그룹 관련 활동 Push" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      finishReload?.({ ...preference, contentPushEnabled: false });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "테스트 그룹 관련 활동 Push" }),
      ).not.toBeChecked(),
    );
  });
});
