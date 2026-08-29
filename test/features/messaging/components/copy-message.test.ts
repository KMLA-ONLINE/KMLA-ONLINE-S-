import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyMessageText } from "~/features/messaging/components/copy-message";

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

describe("copyMessageText", () => {
  it("메시지 원문을 클립보드에 복사한다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await copyMessageText("축제 부스 배치 초안 확인했어요?");

    expect(writeText).toHaveBeenCalledWith("축제 부스 배치 초안 확인했어요?");
  });

  it("클립보드 오류를 사용자에게 알린다", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard(writeText);
    const errorToast = vi.spyOn(toast, "error");

    await copyMessageText("메시지");

    expect(errorToast).toHaveBeenCalledWith("메시지를 복사하지 못했습니다.");
  });
});
