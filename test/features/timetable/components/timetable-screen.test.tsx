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

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

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

describe("TimetableScreen copy and paste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    timetableData.loadTimetableRecord.mockResolvedValue({
      activeSemester: "1-1",
      semesters: {
        "1-1": [
          {
            id: "math",
            name: "수학",
            color: 3,
            room: "301",
            meetings: [{ id: "m1", day: 0, start: 1, end: 2 }],
          },
          {
            id: "english",
            name: "영어",
            color: 5,
            room: "",
            meetings: [{ id: "e1", day: 1, start: 3, end: 3 }],
          },
        ],
        "1-2": [],
        "2-1": [],
        "2-2": [],
        "3-1": [],
        "3-2": [],
      },
    });
    timetableData.saveTimetableRecord.mockResolvedValue(undefined);
  });

  it("수정 창에 보이는 그대로 수업을 복사해 다른 학기의 같은 요일·교시에 붙여 넣는다", async () => {
    const { user } = renderRoute(TimetableScreen, {
      path: "/menu/timetable",
    });

    await user.click(await screen.findByRole("button", { name: "수학 수정" }));
    // 저장하지 않은 수정도 복사본에 들어간다.
    const room = screen.getByRole("textbox", { name: "장소" });
    await user.clear(room);
    await user.type(room, "302");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "수업 복사",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("‘수학’ 복사됨");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "학기" }),
      "2-2",
    );
    await user.click(screen.getByRole("button", { name: "붙여넣기" }));

    expect(
      screen.getByRole("button", { name: "수학 수정" }),
    ).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("‘수학’ 붙여넣음");
    expect(timetableData.saveTimetableRecord).toHaveBeenLastCalledWith(
      17,
      "2-2",
      expect.objectContaining({
        "1-1": expect.arrayContaining([
          expect.objectContaining({ id: "math", room: "301" }),
        ]),
        "2-2": [
          expect.objectContaining({
            name: "수학",
            room: "302",
            meetings: [expect.objectContaining({ day: 0, start: 1, end: 2 })],
          }),
        ],
      }),
    );
  });

  it("학기 전체를 복사해 다른 학기에 붙이고, 원래 학기는 비울 수 있다", async () => {
    const { user } = renderRoute(TimetableScreen, {
      path: "/menu/timetable",
    });
    await screen.findByRole("button", { name: "수학 수정" });

    await user.click(screen.getByRole("button", { name: "학기 메뉴" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "이 학기 시간표 복사" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "1학년 1학기 시간표 복사됨",
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "학기" }),
      "2-2",
    );
    await user.click(screen.getByRole("button", { name: "붙여넣기" }));
    expect(
      screen.getByRole("button", { name: "수학 수정" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "영어 수정" }),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "학기" }),
      "1-1",
    );
    await user.click(screen.getByRole("button", { name: "학기 메뉴" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "이 학기 비우기" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "비우기",
      }),
    );

    expect(
      screen.queryByRole("button", { name: "수학 수정" }),
    ).not.toBeInTheDocument();
    expect(timetableData.saveTimetableRecord).toHaveBeenLastCalledWith(
      17,
      "1-1",
      expect.objectContaining({
        "1-1": [],
        "2-2": [
          expect.objectContaining({ name: "수학" }),
          expect.objectContaining({ name: "영어" }),
        ],
      }),
    );
  });

  it("수업이 있는 학기에 학기 전체를 붙이면 덮어쓸지 묻는다", async () => {
    const { user } = renderRoute(TimetableScreen, {
      path: "/menu/timetable",
    });
    await screen.findByRole("button", { name: "수학 수정" });

    await user.click(screen.getByRole("button", { name: "학기 메뉴" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "이 학기 시간표 복사" }),
    );
    await user.click(screen.getByRole("button", { name: "붙여넣기" }));

    const confirm = screen.getByRole("dialog", {
      name: "1학년 1학기 시간표를 덮어쓸까요?",
    });
    await user.click(within(confirm).getByRole("button", { name: "취소" }));
    expect(screen.getAllByRole("button", { name: "수학 수정" })).toHaveLength(
      1,
    );
  });

  it("겹치는 수업이 있으면 붙여 넣지 않고 알린다", async () => {
    const { user } = renderRoute(TimetableScreen, {
      path: "/menu/timetable",
    });

    await user.click(await screen.findByRole("button", { name: "수학 수정" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "수업 복사",
      }),
    );
    await user.click(screen.getByRole("button", { name: "붙여넣기" }));

    expect(toast.error).toHaveBeenCalledWith(
      "시간이 겹치는 수업이 있어 붙여 넣지 못했습니다.",
    );
    expect(screen.getAllByRole("button", { name: "수학 수정" })).toHaveLength(
      1,
    );
  });
});
