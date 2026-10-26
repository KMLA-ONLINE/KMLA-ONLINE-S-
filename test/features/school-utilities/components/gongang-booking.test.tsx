import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, renderRoute, within } from "../../../router";
const data = vi.hoisted(() => ({
  loadUtilityReservations: vi.fn(),
  createUtilityReservations: vi.fn(),
  deleteUtilityReservation: vi.fn(),
  canManageGongang: vi.fn(),
  loadGongangSchedule: vi.fn(),
  saveGongangSchedule: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { GongangBookingScreen } from "~/features/school-utilities/components/gongang-booking-screen";
import { GongangScheduleManager } from "~/features/school-utilities/components/gongang-schedule-manager";

beforeEach(() => {
  vi.clearAllMocks();
  viewer.role = "user";
  data.loadUtilityReservations.mockResolvedValue([]);
  data.loadGongangSchedule.mockResolvedValue([]);
  data.canManageGongang.mockResolvedValue(false);
  data.createUtilityReservations.mockResolvedValue(undefined);
  data.saveGongangSchedule.mockResolvedValue(undefined);
});
describe("gongang booking flow", () => {
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

  it("books several weekend times with one purpose and retains selection across floors", async () => {
    const { user } = renderRoute(GongangBookingScreen);
    await screen.findByRole("table", { name: "공강 예약" });
    await user.click(screen.getByRole("button", { name: "10월 17일 토요일" }));
    await user.click(
      screen.getByRole("button", { name: "08:00–09:00 지하 1층 선택" }),
    );
    await user.click(
      screen.getByRole("button", { name: "09:00–10:00 지하 1층 선택" }),
    );
    await user.click(screen.getByRole("button", { name: "2층" }));
    await user.click(
      screen.getByRole("button", { name: "10:00–11:00 2층 선택" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "사용 목적" }),
      "동아리 연습",
    );
    await user.click(screen.getByRole("button", { name: "3건 예약" }));
    await waitFor(() =>
      expect(data.createUtilityReservations).toHaveBeenCalledExactlyOnceWith([
        {
          profileId: 1,
          mode: "gongang",
          reservationDate: "2026-10-17",
          slot: "hour-8",
          location: "floor_b1",
          detail: "동아리 연습",
          recurring: false,
        },
        {
          profileId: 1,
          mode: "gongang",
          reservationDate: "2026-10-17",
          slot: "hour-9",
          location: "floor_b1",
          detail: "동아리 연습",
          recurring: false,
        },
        {
          profileId: 1,
          mode: "gongang",
          reservationDate: "2026-10-17",
          slot: "hour-10",
          location: "floor_2",
          detail: "동아리 연습",
          recurring: false,
        },
      ]),
    );
    expect(
      await screen.findByRole("button", { name: "10:00–11:00 2층 선택" }),
    ).toBeInTheDocument();
  });
  it("keeps the chosen weekend floor when moving to another day", async () => {
    const { user } = renderRoute(GongangBookingScreen);
    await screen.findByRole("table", { name: "공강 예약" });
    await user.click(screen.getByRole("button", { name: "10월 17일 토요일" }));
    await user.click(screen.getByRole("button", { name: "10층" }));
    await user.click(screen.getByRole("button", { name: "10월 18일 일요일" }));
    expect(screen.getByRole("button", { name: "10층" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "08:00–09:00 10층 선택" }),
    ).toBeInTheDocument();
  });
  it("replaces the weekday choice instead of adding to it", async () => {
    const { user } = renderRoute(GongangBookingScreen);
    await user.click(
      await screen.findByRole("button", { name: "점심 지하 1층 선택" }),
    );
    await user.click(screen.getByRole("button", { name: "저녁 2층 선택" }));
    expect(
      screen.getByRole("button", { name: "점심 지하 1층 선택" }),
    ).toHaveAttribute("aria-pressed", "false");
    await user.type(
      screen.getByRole("textbox", { name: "사용 목적" }),
      "스터디",
    );
    await user.click(screen.getByRole("button", { name: "1건 예약" }));
    await waitFor(() =>
      expect(data.createUtilityReservations).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ slot: "dinner", location: "floor_2" }),
      ]),
    );
  });
  it("drops a weekend cell from the selection through its chip", async () => {
    const { user } = renderRoute(GongangBookingScreen);
    await screen.findByRole("table", { name: "공강 예약" });
    await user.click(screen.getByRole("button", { name: "10월 17일 토요일" }));
    await user.click(
      screen.getByRole("button", { name: "08:00–09:00 지하 1층 선택" }),
    );
    await user.click(
      screen.getByRole("button", { name: "09:00–10:00 지하 1층 선택" }),
    );
    await user.click(
      screen.getByRole("button", { name: "지하 1층 08:00–09:00 선택 해제" }),
    );
    expect(screen.getByRole("button", { name: "1건 예약" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "08:00–09:00 지하 1층 선택" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
  it("names the cell someone else took when a batch fails", async () => {
    data.createUtilityReservations.mockRejectedValueOnce({
      code: "23505",
      message: "reservation slot is already occupied",
    });
    const { user } = renderRoute(GongangBookingScreen);
    await screen.findByRole("table", { name: "공강 예약" });
    await user.click(screen.getByRole("button", { name: "10월 17일 토요일" }));
    await user.click(
      screen.getByRole("button", { name: "08:00–09:00 지하 1층 선택" }),
    );
    await user.click(
      screen.getByRole("button", { name: "09:00–10:00 지하 1층 선택" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "사용 목적" }),
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
    await user.click(screen.getByRole("button", { name: "2건 예약" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "다른 예약이 등록되어 다음 시간대의 선택을 해제했습니다: 지하 1층 09:00–10:00. 나머지 시간대는 예약할 수 있습니다.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "다른 사용자가 먼저 예약했습니다.",
    );
    expect(screen.getByRole("button", { name: "1건 예약" })).toBeEnabled();
  });
  it("does not expose an empty bookable board when loading fails", async () => {
    data.loadGongangSchedule.mockRejectedValueOnce(new Error("offline"));
    renderRoute(GongangBookingScreen);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "예약을 불러오지 못했습니다. 다시 시도해 주세요.",
    );
    expect(
      screen.getByRole("button", { name: "점심 지하 1층 선택" }),
    ).toBeDisabled();
  });
  it("allows an app administrator to create a recurring prebooking without a separate manager grant", async () => {
    viewer.role = "admin";
    const { user } = renderRoute(GongangScheduleManager);
    await user.click(
      await screen.findByRole("button", { name: "점심 지하 1층 선택" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "사용 목적" }),
      "정기 모임",
    );
    await user.click(screen.getByRole("checkbox", { name: "매주 반복" }));
    await user.click(screen.getByRole("button", { name: "1건 선예약" }));
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
    expect(
      screen.getByRole("button", { name: "지하 1층 1자습 선택 해제" }),
    ).toHaveTextContent("홍길동 장기 예약 종료");
    await user.type(
      screen.getByRole("textbox", { name: "사용 목적" }),
      "학생회 회의",
    );
    await user.click(screen.getByRole("button", { name: "1건 선예약" }));
    await user.click(
      await screen.findByRole("button", { name: "종료하고 선예약" }),
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
  it("limits a manager to one weekday cell but several weekend hours", async () => {
    viewer.role = "admin";
    const { user } = renderRoute(GongangScheduleManager);
    await user.click(
      await screen.findByRole("button", { name: "점심 지하 1층 선택" }),
    );
    await user.click(screen.getByRole("button", { name: "저녁 2층 선택" }));
    expect(screen.getByRole("button", { name: "1건 선예약" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "10월 24일 토요일" }));
    await user.click(
      screen.getByRole("button", { name: "08:00–09:00 지하 1층 선택" }),
    );
    await user.click(
      screen.getByRole("button", { name: "09:00–10:00 지하 1층 선택" }),
    );
    expect(screen.getByRole("button", { name: "2건 선예약" })).toBeVisible();
  });
});

describe("gongang screens in English", () => {
  afterEach(() => window.localStorage.clear());

  it("translates the booking board, the week strip and the selection form", async () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    const { user } = renderRoute(GongangBookingScreen);
    const table = await screen.findByRole("table", {
      name: "Free period reservations",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Time", "B1", "2F", "4F", "10F"]);
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Lunch", "Dinner", "Study 1", "After HJ", "Study 2"]);
    expect(screen.getByRole("link", { name: "Free period" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Karaoke" })).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Saturday, October 17" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Select 08:00–09:00 B1" }),
    );
    expect(screen.getByText("1 cell selected")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Purpose" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reserve 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeVisible();
  });

  it("translates the manager screen", async () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    viewer.role = "admin";
    renderRoute(GongangScheduleManager);
    expect(
      await screen.findByRole("heading", { name: "Next week's prebookings" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to free period" }),
    ).toBeVisible();
  });
});
