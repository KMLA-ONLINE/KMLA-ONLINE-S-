import { beforeEach, describe, expect, it, vi } from "vitest";
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
    await user.click(screen.getByRole("button", { name: "3건 신청" }));
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
  it("does not expose an empty bookable board when loading fails", async () => {
    data.loadGongangSchedule.mockRejectedValueOnce(new Error("offline"));
    renderRoute(GongangBookingScreen);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "예약을 불러오지 못했습니다",
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
});
