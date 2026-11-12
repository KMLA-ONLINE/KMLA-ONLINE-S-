import { describe, expect, it, vi } from "vitest";

import { UtilityBookingScreen } from "~/features/school-utilities/components/utility-booking-screen";
import { act, renderRoute, screen, waitFor, within } from "../../../router";

const data = vi.hoisted(() => ({
  loadUtilityReservations: vi.fn().mockResolvedValue([]),
  createUtilityReservation: vi.fn(),
  deleteUtilityReservation: vi.fn(),
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

const ownLunch = {
  id: 7,
  profileId: 1,
  mode: "karaoke",
  reservationDate: "2026-10-14",
  slot: "lunch",
  location: null,
  detail: "김민수",
  recurring: false,
  recurringUntil: null,
  applicantName: "김민수",
  applicantPubId: "kim",
  applicantCohort: 30,
  avatarUrl: null,
};

describe("karaoke booking", () => {
  it("names the action as a reservation and asks for the people using the room", async () => {
    data.createUtilityReservation.mockReturnValue(new Promise(() => undefined));
    const { user } = renderRoute(() => <UtilityBookingScreen mode="karaoke" />);

    await user.click(
      await screen.findByRole("button", { name: /점심\s*예약/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "점심" });
    const names = within(dialog).getByRole("textbox", { name: "이용자 명단" });
    expect(names).toHaveAttribute("placeholder", "이용자 명단");
    await user.type(names, "김민수, 이지수");
    await user.click(within(dialog).getByRole("button", { name: "예약" }));

    expect(
      within(dialog).getByRole("button", { name: "예약 중…" }),
    ).toBeDisabled();
    expect(data.createUtilityReservation).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "김민수, 이지수", mode: "karaoke" }),
    );
  });

  it("marks past empty slots with a dash instead of a booking action", async () => {
    const { user } = renderRoute(() => <UtilityBookingScreen mode="karaoke" />);

    await user.click(
      await screen.findByRole("button", { name: "10월 13일 화요일" }),
    );
    expect(
      screen.queryByRole("button", { name: /예약$/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    // The dash is decorative; screen readers hear the status instead.
    expect(screen.getAllByText("지난 시간")).toHaveLength(2);
  });

  it("does not show an empty bookable list when loading fails, and retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    data.loadUtilityReservations.mockRejectedValueOnce(new Error("offline"));
    const { user } = renderRoute(() => <UtilityBookingScreen mode="karaoke" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "예약을 불러오지 못했습니다.",
    );
    expect(
      screen.queryByRole("button", { name: /점심\s*예약/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByRole("button", { name: /점심\s*예약/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks before cancelling one's own reservation", async () => {
    data.loadUtilityReservations.mockResolvedValueOnce([ownLunch]);
    data.deleteUtilityReservation.mockResolvedValue(undefined);
    const { user } = renderRoute(() => <UtilityBookingScreen mode="karaoke" />);

    await user.click(
      await screen.findByRole("button", { name: "점심 예약 취소" }),
    );
    const dialog = screen.getByRole("dialog", { name: "예약 취소" });
    expect(data.deleteUtilityReservation).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "예약 취소" }));
    expect(data.deleteUtilityReservation).toHaveBeenCalledWith(7);
  });

  it("closes the cancel dialog when the reservation is already gone", async () => {
    data.loadUtilityReservations.mockResolvedValueOnce([ownLunch]);
    data.deleteUtilityReservation.mockClear();
    const { user } = renderRoute(() => <UtilityBookingScreen mode="karaoke" />);

    await user.click(
      await screen.findByRole("button", { name: "점심 예약 취소" }),
    );
    const dialog = screen.getByRole("dialog", { name: "예약 취소" });

    // Someone else cancelled it; the focus refresh no longer returns the row.
    // Let the focus refresh settle before the next step.
    await act(() => {
      window.dispatchEvent(new Event("focus"));
      return Promise.resolve();
    });
    await user.click(within(dialog).getByRole("button", { name: "예약 취소" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "예약 취소" }),
      ).not.toBeInTheDocument(),
    );
    expect(data.deleteUtilityReservation).not.toHaveBeenCalled();
  });

  it("closes the dialog with a notice when someone books the slot first", async () => {
    const { user } = renderRoute(() => <UtilityBookingScreen mode="karaoke" />);
    await user.click(
      await screen.findByRole("button", { name: /저녁\s*예약/ }),
    );
    expect(screen.getByRole("dialog", { name: "저녁" })).toBeVisible();

    data.loadUtilityReservations
      .mockResolvedValueOnce([
        {
          ...ownLunch,
          id: 8,
          profileId: 2,
          slot: "dinner",
          applicantName: "홍길동",
        },
      ])
      .mockResolvedValueOnce([]);
    await act(() => {
      window.dispatchEvent(new Event("focus"));
      return Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "다른 사용자가 먼저 예약했습니다.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(() => {
      window.dispatchEvent(new Event("focus"));
      return Promise.resolve();
    });
    await screen.findByRole("button", { name: /저녁\s*예약/ });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the loaded list but blocks booking when a refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    data.loadUtilityReservations
      .mockResolvedValueOnce([ownLunch])
      .mockRejectedValueOnce(new Error("offline"));
    renderRoute(() => <UtilityBookingScreen mode="karaoke" />);
    await screen.findByRole("link", { name: "김민수 프로필" });

    // Let the focus refresh settle before the next step.
    await act(() => {
      window.dispatchEvent(new Event("focus"));
      return Promise.resolve();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "예약을 불러오지 못했습니다.",
    );
    expect(
      screen.getByRole("link", { name: "김민수 프로필" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /저녁\s*예약/ })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "점심 예약 취소" }),
    ).not.toBeInTheDocument();
  });
});
