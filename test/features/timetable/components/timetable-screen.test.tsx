import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimetableScreen } from "~/features/timetable/components/timetable-screen";
import { renderRoute, screen, within } from "../../../router";

const timetableData = vi.hoisted(() => ({
  loadTimetableRecord: vi.fn(),
  saveTimetableRecord: vi.fn(),
}));

vi.mock("~/features/app-shell", () => ({
  useAppShell: () => ({ profile: { id: 17 } }),
}));

vi.mock("~/features/timetable/data/timetable", () => timetableData);

describe("TimetableScreen colors", () => {
  beforeEach(() => {
    localStorage.clear();
    timetableData.loadTimetableRecord.mockResolvedValue(null);
    timetableData.saveTimetableRecord.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("lets a student choose a shade and saves that course color", async () => {
    // HTTP LAN previews have getRandomValues but not randomUUID.
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(1),
    });
    const { user } = renderRoute(TimetableScreen, {
      path: "/menu/timetable",
    });

    await user.click(
      screen.getByRole("button", { name: "월요일 1교시 수업 추가" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "과목명" }),
      "수학",
    );
    await user.click(within(dialog).getByRole("button", { name: "색상 1" }));
    const shades = within(dialog).getByRole("group", { name: "색상 1 밝기" });
    await user.click(within(shades).getByRole("button", { name: "밝기 4" }));
    expect(
      within(shades).getByRole("button", { name: "밝기 4" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    expect(screen.getByRole("button", { name: "수학 수정" })).toHaveClass(
      "bg-rose-500",
    );
    expect(timetableData.saveTimetableRecord).toHaveBeenLastCalledWith(
      17,
      "1-1",
      expect.objectContaining({
        "1-1": [expect.objectContaining({ name: "수학", color: 12 })],
      }),
    );
  });
});

describe("TimetableScreen in English", () => {
  beforeEach(() => {
    localStorage.clear();
    timetableData.loadTimetableRecord.mockResolvedValue(null);
    timetableData.saveTimetableRecord.mockResolvedValue(undefined);
  });

  afterEach(() => localStorage.clear());

  it("translates the semester picker, the grid and the course dialog", async () => {
    localStorage.setItem("kmla-online:language:v1", "en");
    const { user } = renderRoute(TimetableScreen, { path: "/menu/timetable" });

    expect(
      screen.getByRole("combobox", { name: "Semester" }),
    ).toHaveTextContent("Year 1, Semester 1");
    expect(screen.getByText("Mon")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Add a class on Monday, Period 1" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Add class" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("textbox", { name: "Subject" }),
    ).toBeVisible();
    expect(within(dialog).getByRole("textbox", { name: "Room" })).toBeVisible();
    expect(
      within(dialog).getByRole("combobox", { name: "Start period" }),
    ).toHaveTextContent("Period 1");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
