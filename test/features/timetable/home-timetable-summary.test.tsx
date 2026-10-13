import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeTimetableSummary } from "~/features/timetable";
import { TIMETABLE_STORAGE_KEY } from "~/shared/lib/user-scoped-storage";
import { renderRoute, screen, within } from "../../router";

const database = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const upsert = vi.fn();
  const from = vi.fn(() => ({ select, upsert }));
  return { maybeSingle, eq, select, upsert, from };
});

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ from: database.from }),
}));

const course = {
  id: "math",
  name: "미적분",
  color: 2,
  room: "수학실",
  meetings: [{ id: "monday", day: 0, start: 2, end: 3 }],
};

function renderSummary() {
  return renderRoute(() => <HomeTimetableSummary profileId={17} />, {
    routes: [
      {
        path: "/menu/timetable",
        Component: () => <h1>시간표 화면</h1>,
      },
    ],
  });
}

describe("HomeTimetableSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T23:30:00Z"));
    database.maybeSingle.mockResolvedValue({
      data: {
        active_semester: "2-1",
        semesters: {
          "1-1": [{ ...course, name: "다른 학기 수업" }],
          "2-1": [
            course,
            {
              ...course,
              id: "tuesday",
              name: "화요일 수업",
              meetings: [{ id: "tuesday", day: 1, start: 1, end: 1 }],
            },
          ],
        },
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens the timetable from its content without a date while showing the active semester's periods", async () => {
    const { user } = renderSummary();

    const table = await screen.findByRole("table", { name: "오늘의 시간표" });
    const link = screen.getByRole("link", { name: "시간표 보기" });
    expect(link).toHaveAttribute("href", "/menu/timetable");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText("전체 보기")).not.toBeInTheDocument();
    expect(within(link).getByRole("table")).toBe(table);
    expect(
      within(link).queryByText("10월 12일 월요일"),
    ).not.toBeInTheDocument();
    expect(within(link).queryByRole("button")).not.toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(8);
    expect(within(rows[1]).getByText("미적분")).toBeVisible();
    expect(within(rows[2]).getByText("미적분")).toBeVisible();
    expect(within(rows[1]).getByText("수학실")).toBeVisible();
    expect(within(rows[1]).getByText("09:30")).toBeVisible();
    expect(database.from).toHaveBeenCalledWith("user_timetables");
    expect(database.eq).toHaveBeenCalledWith("profile_id", 17);
    expect(screen.queryByText("다른 학기 수업")).not.toBeInTheDocument();
    expect(screen.queryByText("화요일 수업")).not.toBeInTheDocument();
    await user.click(within(link).getAllByText("미적분")[0]);
    expect(
      await screen.findByRole("heading", { name: "시간표 화면" }),
    ).toBeVisible();
  });

  it("keeps all eight periods literally blank on an empty weekday and offers no editing controls", async () => {
    database.maybeSingle.mockResolvedValue({ data: null, error: null });
    const { user } = renderSummary();

    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    for (const cell of within(table).getAllByRole("cell")) {
      expect(cell).toBeEmptyDOMElement();
    }
    expect(screen.queryByText("공강")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(database.upsert).not.toHaveBeenCalled();
    await user.click(within(table).getAllByRole("cell")[0]);
    expect(
      await screen.findByRole("heading", { name: "시간표 화면" }),
    ).toBeVisible();
  });

  it.each([
    ["2026-10-16T16:00:00Z", "10월 17일 토요일"],
    ["2026-10-17T16:00:00Z", "10월 18일 일요일"],
  ])(
    "shows the weekend message instead of a period grid at %s",
    async (now, date) => {
      vi.setSystemTime(new Date(now));
      const { user } = renderSummary();

      expect(
        await screen.findByText("주말에는 시간표가 없습니다"),
      ).toBeVisible();
      expect(screen.queryByText(date)).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      await user.click(screen.getByText("주말에는 시간표가 없습니다"));
      expect(
        await screen.findByRole("heading", { name: "시간표 화면" }),
      ).toBeVisible();
    },
  );

  it("shows loading rather than an empty day until an uncached database read finishes", async () => {
    database.maybeSingle.mockReturnValue(
      new Promise(() => {
        // Keep the database pending while the loading UI is observed.
      }),
    );
    const { user } = renderSummary();

    const pending = await screen.findByRole("region", {
      name: "시간표를 불러오는 중",
    });
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).toHaveTextContent("시간표를 불러오는 중");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(pending);
    expect(
      await screen.findByRole("heading", { name: "시간표 화면" }),
    ).toBeVisible();
  });

  it("reports a database failure without presenting an uncached day as empty", async () => {
    database.maybeSingle.mockResolvedValue({
      data: null,
      error: new Error("offline"),
    });
    const { user } = renderSummary();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "시간표를 불러오지 못했습니다",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("alert"));
    expect(
      await screen.findByRole("heading", { name: "시간표 화면" }),
    ).toBeVisible();
  });

  it("renders the device cache immediately and retains it with a warning if the read fails, without writes", async () => {
    const cached = JSON.stringify({
      activeSemester: "3-2",
      semesters: { "3-2": [course] },
    });
    localStorage.setItem(TIMETABLE_STORAGE_KEY, cached);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    let fail!: (result: { data: null; error: Error }) => void;
    database.maybeSingle.mockReturnValue(
      new Promise((resolve) => {
        fail = resolve;
      }),
    );
    renderRoute(() => <HomeTimetableSummary profileId={17} />);

    expect(await screen.findAllByText("미적분")).toHaveLength(2);
    fail({ data: null, error: new Error("offline") });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "기기에 저장된 시간표를 표시합니다",
    );
    expect(screen.getAllByText("미적분")).toHaveLength(2);
    expect(database.upsert).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(localStorage.getItem(TIMETABLE_STORAGE_KEY)).toBe(cached);
  });

  it("replaces the cached active semester with the database record without persisting from the widget", async () => {
    localStorage.setItem(
      TIMETABLE_STORAGE_KEY,
      JSON.stringify({
        activeSemester: "1-1",
        semesters: { "1-1": [{ ...course, name: "옛 수업" }] },
      }),
    );
    const writes = vi.spyOn(Storage.prototype, "setItem");
    renderRoute(() => <HomeTimetableSummary profileId={17} />);

    expect(await screen.findAllByText("미적분")).toHaveLength(2);
    expect(screen.queryByText("옛 수업")).not.toBeInTheDocument();
    expect(writes).not.toHaveBeenCalled();
    expect(database.upsert).not.toHaveBeenCalled();
  });

  it("treats an invalid device cache as unavailable rather than a known empty timetable", async () => {
    localStorage.setItem(TIMETABLE_STORAGE_KEY, "not json");
    database.maybeSingle.mockResolvedValue({
      data: null,
      error: new Error("offline"),
    });
    renderRoute(() => <HomeTimetableSummary profileId={17} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "시간표를 불러오지 못했습니다",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
