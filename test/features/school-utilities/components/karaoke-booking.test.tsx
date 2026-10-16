import { describe, expect, it, vi } from "vitest";

import { UtilityBookingScreen } from "~/features/school-utilities/components/utility-booking-screen";
import { renderRoute, screen } from "../../../router";

const data = vi.hoisted(() => ({
  loadUtilityReservations: vi.fn().mockResolvedValue([]),
  createUtilityReservation: vi.fn(),
}));
vi.mock("~/features/school-utilities/data/reservations", () => data);
vi.mock("~/features/app-shell", () => ({
  useAppShell: () => ({ profile: { id: 1 } }),
}));
vi.mock(
  "~/features/school-utilities/model/korea-date",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useKoreaToday: () => "2026-10-14",
  }),
);

describe("karaoke booking", () => {
  it("names the action as a reservation and asks for the people using the room", async () => {
    data.createUtilityReservation.mockReturnValue(new Promise(() => undefined));
    const { user } = renderRoute(() => <UtilityBookingScreen mode="karaoke" />);

    await user.click(
      await screen.findByRole("button", { name: /점심\s*예약/ }),
    );
    const names = screen.getByRole("textbox", { name: "이용자 명단" });
    expect(names).toHaveAttribute("placeholder", "이용자 명단");
    await user.type(names, "김민수, 이지수");
    await user.click(screen.getByRole("button", { name: "예약" }));

    expect(screen.getByRole("button", { name: "예약 중…" })).toBeDisabled();
    expect(data.createUtilityReservation).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "김민수, 이지수", mode: "karaoke" }),
    );
    await user.click(screen.getByRole("button", { name: "10월 13일 화요일" }));
    expect(screen.getAllByText("예약 마감")).toHaveLength(2);
  });
});
