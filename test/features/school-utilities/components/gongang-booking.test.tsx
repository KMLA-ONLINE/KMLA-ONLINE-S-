import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, renderRoute, within } from "../../../router";
const data = vi.hoisted(() => ({
  loadUtilityReservations: vi.fn(),
  createUtilityReservations: vi.fn(),
  deleteUtilityReservation: vi.fn(),
  canManageGongang: vi.fn(),
  loadGongangSchedule: vi.fn(),
  saveGongangSchedule: vi.fn(),
  loadGongangManagers: vi.fn(),
}));
const viewer = vi.hoisted(() => ({ id: 1, role: "user" }));
vi.mock("~/features/app-shell", () => ({
  useAppShell: () => ({ profile: viewer }),
}));
vi.mock("~/features/school-utilities/data/reservations", () => data);
vi.mock("~/features/school-utilities/data/gongang-schedule", () => data);
vi.mock(
  "~/features/school-utilities/model/korea-date",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useKoreaToday: () => "2026-10-14",
  }),
);
import { GongangBookingScreen } from "~/features/school-utilities/components/gongang-booking-screen";
import { GongangScheduleManager } from "~/features/school-utilities/components/gongang-schedule-manager";
import { UtilityBookingScreen } from "~/features/school-utilities/components/utility-booking-screen";

beforeEach(() => {
  vi.clearAllMocks();
  viewer.role = "user";
  data.loadUtilityReservations.mockResolvedValue([]);
  data.loadGongangSchedule.mockResolvedValue([]);
  data.canManageGongang.mockResolvedValue(false);
  data.createUtilityReservations.mockResolvedValue(undefined);
  data.saveGongangSchedule.mockResolvedValue(undefined);
  data.loadGongangManagers.mockResolvedValue([]);
});
describe("gongang booking flow", () => {
  it("offers prebooking to a listed manager without a second grant lookup", async () => {
    data.loadGongangManagers.mockResolvedValue([
      { profileId: 1, label: "29기 김민준" },
    ]);
    renderRoute(GongangBookingScreen);

    expect(
      await screen.findByRole("link", { name: "선예약 관리" }),
    ).toHaveAttribute("href", "/menu/gongang/manage");
    expect(data.canManageGongang).not.toHaveBeenCalled();
  });
  it("names the holders of the gongang manager grant", async () => {
    data.loadGongangManagers.mockResolvedValue([
      { profileId: 5, label: "30기 최진명" },
      { profileId: 6, label: "김선생" },
    ]);
    renderRoute(() => <UtilityBookingScreen mode="gongang" />);

    expect(
      await screen.findByText("30기 최진명, 김선생", { exact: false }),
    ).toHaveTextContent("공강관리자: 30기 최진명, 김선생");
  });
  it("shows another applicant once in the detail dialog and keeps the profile link", async () => {
    data.loadUtilityReservations.mockResolvedValue([
      {
        id: 10,
        profileId: 2,
        mode: "gongang",
        reservationDate: "2026-10-14",
        slot: "study-1",
        location: "floor_b1",
        detail: "합주 연습",
        recurring: false,
        recurringUntil: null,
        applicantName: "홍길동",
        applicantPubId: "hong-gildong",
        applicantCohort: 30,
        avatarUrl: null,
      },
    ]);
    const { user } = renderRoute(GongangBookingScreen);
    await user.click(
      await screen.findByRole("button", { name: "1자습 지하 1층 홍길동" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("홍길동", { exact: true })).toHaveLength(
      1,
    );
    expect(
      within(dialog).getByRole("link", { name: "홍길동" }),
    ).toHaveAttribute("href", "/profile/hong-gildong");
    expect(within(dialog).getByText("합주 연습")).toBeVisible();
  });

  it("books one weekend cell through its dialog", async () => {
    const { user } = renderRoute(GongangBookingScreen);
    await screen.findByRole("table", { name: "공강 예약" });
    await user.click(screen.getByRole("button", { name: "10월 17일 토요일" }));
    await user.click(
      screen.getByRole("button", { name: "09:00–10:00 2층 선택" }),
    );
    const dialog = screen.getByRole("dialog", { name: "2층 09:00–10:00" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "사용 목적" }),
      "동아리 연습",
    );
    await user.click(within(dialog).getByRole("button", { name: "예약" }));
    await waitFor(() =>
      expect(data.createUtilityReservations).toHaveBeenCalledExactlyOnceWith([
        {
          profileId: 1,
          mode: "gongang",
          reservationDate: "2026-10-17",
          slot: "hour-9",
          location: "floor_2",
          detail: "동아리 연습",
          recurring: false,
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("books a weekly weekday repeat from the dialog", async () => {
    const { user } = renderRoute(GongangBookingScreen);
    await user.click(
      await screen.findByRole("button", { name: "저녁 2층 선택" }),
    );
    const dialog = screen.getByRole("dialog", { name: "2층 저녁" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "사용 목적" }),
      "스터디",
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "매주 반복" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "예약" }));
    await waitFor(() =>
      expect(data.createUtilityReservations).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({
          slot: "dinner",
          location: "floor_2",
          detail: "스터디",
          recurring: true,
        }),
      ]),
    );
  });
  it("closes the dialog and shows the taker when someone books the cell first", async () => {
    data.createUtilityReservations.mockRejectedValueOnce({
      code: "23505",
      message: "reservation slot is already occupied",
    });
    const { user } = renderRoute(GongangBookingScreen);
    await screen.findByRole("table", { name: "공강 예약" });
    await user.click(screen.getByRole("button", { name: "10월 17일 토요일" }));
    await user.click(
      screen.getByRole("button", { name: "09:00–10:00 지하 1층 선택" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "사용 목적" }),
      "동아리 연습",
    );
    data.loadUtilityReservations.mockResolvedValue([
      {
        id: 12,
        profileId: 2,
        mode: "gongang",
        reservationDate: "2026-10-17",
        slot: "hour-9",
        location: "floor_b1",
        detail: "밴드",
        recurring: false,
        recurringUntil: null,
        applicantName: "홍길동",
        applicantPubId: "hong-gildong",
        applicantCohort: 30,
        avatarUrl: null,
      },
    ]);
    await user.click(within(dialog).getByRole("button", { name: "예약" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "다른 사용자가 먼저 예약했습니다.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "09:00–10:00 지하 1층 홍길동" }),
    ).toBeInTheDocument();
  });
  it("closes the dialog with a notice when a refresh shows the cell taken, and keeps it closed after the cell frees up", async () => {
    const { user } = renderRoute(GongangBookingScreen);
    await user.click(
      await screen.findByRole("button", { name: "점심 지하 1층 선택" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();

    data.loadUtilityReservations.mockResolvedValue([
      {
        id: 13,
        profileId: 2,
        mode: "gongang",
        reservationDate: "2026-10-14",
        slot: "lunch",
        location: "floor_b1",
        detail: "밴드",
        recurring: false,
        recurringUntil: null,
        applicantName: "홍길동",
        applicantPubId: "hong-gildong",
        applicantCohort: 30,
        avatarUrl: null,
      },
    ]);
    await act(() => {
      window.dispatchEvent(new Event("focus"));
      return Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "다른 사용자가 먼저 예약했습니다.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    data.loadUtilityReservations.mockResolvedValue([]);
    await act(() => {
      window.dispatchEvent(new Event("focus"));
      return Promise.resolve();
    });
    await screen.findByRole("button", { name: "점심 지하 1층 선택" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("closes the dialog when a refresh fails", async () => {
    data.loadGongangSchedule
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("offline"));
    const { user } = renderRoute(GongangBookingScreen);
    await user.click(
      await screen.findByRole("button", { name: "점심 지하 1층 선택" }),
    );
    await act(() => {
      window.dispatchEvent(new Event("focus"));
      return Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "예약을 불러오지 못했습니다.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps the typed purpose when the dialog is closed and reopened", async () => {
    const { user } = renderRoute(GongangBookingScreen);
    await user.click(
      await screen.findByRole("button", { name: "점심 지하 1층 선택" }),
    );
    await user.type(
      within(screen.getByRole("dialog")).getByRole("textbox", {
        name: "사용 목적",
      }),
      "스터디",
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }),
    );
    await user.click(
      screen.getByRole("button", { name: "점심 지하 1층 선택" }),
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("textbox", {
        name: "사용 목적",
      }),
    ).toHaveValue("스터디");
  });
  it("closes the prebooking dialog when another manager takes the cell", async () => {
    viewer.role = "admin";
    const { user } = renderRoute(GongangScheduleManager);
    await user.click(
      await screen.findByRole("button", { name: "점심 지하 1층 선택" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    data.loadGongangSchedule.mockResolvedValue([
      {
        scheduleDate: "2026-10-19",
        slot: "lunch",
        location: "floor_b1",
        reserved: true,
        detail: "학생회",
        recurring: false,
        recurringUntil: null,
      },
    ]);
    await act(() => {
      window.dispatchEvent(new Event("focus"));
      return Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "다른 사용자가 먼저 예약했습니다.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("does not expose an empty bookable board when loading fails", async () => {
    data.loadGongangSchedule.mockRejectedValueOnce(new Error("offline"));
    renderRoute(GongangBookingScreen);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "예약을 불러오지 못했습니다. 다시 시도해 주세요.",
    );
    expect(
      screen.queryByRole("table", { name: "공강 예약" }),
    ).not.toBeInTheDocument();
  });
  it("keeps the loaded board but blocks booking when a refresh fails", async () => {
    data.loadGongangSchedule
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("offline"));
    renderRoute(GongangBookingScreen);
    await screen.findByRole("table", { name: "공강 예약" });

    // Let the focus refresh settle before the next step.
    await act(() => {
      window.dispatchEvent(new Event("focus"));
      return Promise.resolve();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "예약을 불러오지 못했습니다. 다시 시도해 주세요.",
    );
    expect(
      screen.getByRole("button", { name: "점심 지하 1층 선택" }),
    ).toBeDisabled();
  });
  it("does not show the prebooking screen while a user's manager grant is still being checked", async () => {
    data.canManageGongang.mockReturnValue(new Promise(() => undefined));
    renderRoute(GongangScheduleManager);
    expect(
      await screen.findByRole("status", { name: "예약 불러오는 중" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "다음 주 선예약" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^10월 \d+일/ }),
    ).not.toBeInTheDocument();
  });
  it("allows an app administrator to create a recurring prebooking without a separate manager grant", async () => {
    viewer.role = "admin";
    const { user } = renderRoute(GongangScheduleManager);
    await user.click(
      await screen.findByRole("button", { name: "점심 지하 1층 선택" }),
    );
    const dialog = screen.getByRole("dialog", { name: "지하 1층 점심" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "사용 목적" }),
      "정기 모임",
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "매주 반복" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "선예약" }));
    await waitFor(() =>
      expect(data.saveGongangSchedule).toHaveBeenCalledExactlyOnceWith([
        {
          scheduleDate: "2026-10-19",
          slot: "lunch",
          location: "floor_b1",
          reserved: true,
          detail: "정기 모임",
          recurring: true,
          recurringUntil: null,
        },
      ]),
    );
    expect(data.canManageGongang).not.toHaveBeenCalled();
  });
  it("lets a manager inspect a student repeat before replacing it", async () => {
    viewer.role = "admin";
    data.loadUtilityReservations.mockResolvedValue([
      {
        id: 11,
        profileId: 2,
        mode: "gongang",
        reservationDate: "2026-10-12",
        slot: "study-1",
        location: "floor_b1",
        detail: "합주 연습",
        recurring: true,
        recurringUntil: null,
        applicantName: "홍길동",
        applicantPubId: "hong-gildong",
        applicantCohort: 30,
        avatarUrl: null,
      },
    ]);
    const { user } = renderRoute(GongangScheduleManager);
    await user.click(
      await screen.findByRole("button", { name: "1자습 지하 1층 홍길동" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("link", { name: "홍길동" }),
    ).toHaveAttribute("href", "/profile/hong-gildong");
    expect(within(dialog).getByText("합주 연습")).toBeVisible();
    expect(data.saveGongangSchedule).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "선예약으로 대체" }),
    );
    const booking = screen.getByRole("dialog", { name: "지하 1층 1자습" });
    expect(booking).toHaveTextContent(
      "홍길동의 장기 예약이 이 날짜부터 종료되며 자동으로 복구되지 않습니다.",
    );
    await user.type(
      within(booking).getByRole("textbox", { name: "사용 목적" }),
      "학생회 회의",
    );
    await user.click(
      within(booking).getByRole("button", { name: "종료하고 선예약" }),
    );
    await waitFor(() =>
      expect(data.saveGongangSchedule).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({
          scheduleDate: "2026-10-19",
          slot: "study-1",
          location: "floor_b1",
          detail: "학생회 회의",
        }),
      ]),
    );
  });
});
