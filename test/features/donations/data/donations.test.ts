import { describe, expect, it, vi } from "vitest";

import {
  createDonationRound,
  importDonationItems,
} from "~/features/donations/data/donations";

const rpc = vi.hoisted(() => vi.fn());
const language = vi.hoisted(() => ({ locale: "ko" }));
vi.mock("~/shared/supabase/client", () => ({ getSupabase: () => ({ rpc }) }));
vi.mock("~/shared/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCurrentLocale: () => language.locale,
}));

describe("donation mutation errors", () => {
  it("asks for a new round when items have already been imported", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "items already imported" },
    });
    await expect(importDonationItems(1, [])).rejects.toThrow(
      "이미 물품이 등록된 회차입니다. 새 회차에 업로드해 주세요.",
    );
  });

  it("asks to check the round name and application period", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "invalid donation round" },
    });
    await expect(
      createDonationRound("회차", "invalid", "invalid"),
    ).rejects.toThrow("회차 이름과 신청 기간을 확인해 주세요.");
  });

  it("translates the mapped error when the language is English", async () => {
    language.locale = "en";
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "invalid donation round" },
    });
    try {
      await expect(
        createDonationRound("회차", "invalid", "invalid"),
      ).rejects.toThrow("Check the round name and the application period.");
    } finally {
      language.locale = "ko";
    }
  });
});
