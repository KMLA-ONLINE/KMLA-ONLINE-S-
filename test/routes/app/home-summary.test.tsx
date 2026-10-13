import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShellProvider, type ShellData } from "~/features/app-shell";
import type { MealDay } from "~/features/meal";
import type { BirthdayProfile } from "~/features/profiles";
import FeedPage from "~/routes/app/home";
import { act, renderRoute, screen } from "../../router";

const database = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ rpc: database.rpc }),
}));

const shell: ShellData = {
  email: "student@kmla.hs.kr",
  profile: {
    id: 17,
    pub_id: "student17",
    name: "학생",
    role: "member",
    type: "student",
    status: "accepted",
    avatar_path: null,
  },
};

function renderHome(
  birthdays: Promise<BirthdayProfile[] | null>,
  mealDay: Promise<MealDay | null>,
) {
  return renderRoute(
    (props: ComponentProps<typeof FeedPage>) => (
      <AppShellProvider value={shell}>
        <FeedPage {...props} />
      </AppShellProvider>
    ),
    { loader: () => ({ birthdays, mealDay, stories: [] }) },
  );
}

describe("home school-life summaries", () => {
  beforeEach(() => {
    database.rpc.mockResolvedValue({ data: [], error: null });
  });

  it("shows birthdays without waiting for the meal and announces only the pending meal", async () => {
    renderHome(Promise.resolve([]), new Promise(() => undefined));

    expect(
      await screen.findByText("오늘 생일인 학생이 없습니다"),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "급식을 불러오는 중" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByRole("region", { name: "생일을 불러오는 중" }),
    ).not.toBeInTheDocument();
  });

  it("keeps failed summaries visible and linked instead of removing their content", async () => {
    renderHome(Promise.resolve(null), Promise.resolve(null));

    expect(
      await screen.findByText(/생일 정보를 불러오지 못했습니다/),
    ).toBeVisible();
    expect(screen.getByText(/급식을 불러오지 못했습니다/)).toBeVisible();
    expect(screen.getByRole("link", { name: "생일 보기" })).toHaveAttribute(
      "href",
      "/menu/birthdays",
    );
    expect(screen.getByRole("link", { name: "급식 보기" })).toHaveAttribute(
      "href",
      "/menu/meal",
    );
  });

  it("shows a ready meal while birthdays are pending, then replaces only the birthday loading state", async () => {
    let resolveBirthdays!: (value: BirthdayProfile[]) => void;
    const birthdays = new Promise<BirthdayProfile[]>((resolve) => {
      resolveBirthdays = resolve;
    });
    renderHome(
      birthdays,
      Promise.resolve({ date: "20261014", meals: [], unavailable: false }),
    );

    expect(
      await screen.findByText("현재 시간대에 등록된 식단이 없습니다."),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "생일을 불러오는 중" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByRole("region", { name: "급식을 불러오는 중" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveBirthdays([]);
      await birthdays;
    });

    expect(screen.getByText("오늘 생일인 학생이 없습니다")).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "생일을 불러오는 중" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "급식 보기" })).toBeVisible();
  });
});
