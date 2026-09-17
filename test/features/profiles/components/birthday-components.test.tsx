import { screen } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  BirthdayListScreen,
  HomeBirthdaySummary,
  type BirthdayCalendarProfile,
  type BirthdayProfile,
} from "~/features/profiles";
import { ScrollContainerContext } from "~/shared/lib/scroll-container";
import { renderRoute } from "../../../router";

// 가상화된 목록은 보이는 행의 아바타 URL을 서명받는다. 여기서 보는 것은 행 자체다.
vi.mock("~/features/profiles/data/media", () => ({
  createProfileMediaUrls: () => Promise.resolve(new Map<string, string>()),
}));

/**
 * 목록을 실제 스크롤 컨테이너 안에 넣어 가상화 경로를 켠다. jsdom은 레이아웃을 계산하지
 * 않으므로 목록이 순환을 깔지 말지 판단하는 데 쓰는 `clientHeight`만 심어 준다.
 */
function ScrollHost({
  clientHeight,
  children,
}: {
  clientHeight: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);

  return (
    <ScrollContainerContext.Provider value={ref}>
      <div
        ref={(node) => {
          if (node) {
            Object.defineProperty(node, "clientHeight", {
              value: clientHeight,
              configurable: true,
            });
          }

          ref.current = node;
        }}
      >
        {children}
      </div>
    </ScrollContainerContext.Provider>
  );
}

const birthdays = [
  {
    pub_id: "hanbyeol-25",
    name: "이한별",
    avatar_path: "profiles/25/avatar.webp",
    avatar_url: "https://example.com/hanbyeol.webp",
    cohort: 31,
    is_returning_student: false,
    birthday_month: 8,
    birthday_day: 26,
    birthday_date: "2026-08-26",
  },
] satisfies BirthdayProfile[];

const birthdayCalendar = [
  {
    pub_id: "year-end-25",
    name: "김연말",
    avatar_path: "profiles/25/avatar.webp",
    cohort: 31,
    is_returning_student: false,
    birthday_month: 12,
    birthday_day: 31,
    birthday_date: "2026-12-31",
  },
  {
    pub_id: "new-year-26",
    name: "박새해",
    avatar_path: "profiles/26/avatar.webp",
    cohort: 28,
    is_returning_student: true,
    birthday_month: 1,
    birthday_day: 1,
    birthday_date: "2027-01-01",
  },
  {
    pub_id: "teacher-spring",
    name: "최봄",
    avatar_path: "profiles/teacher/avatar.webp",
    cohort: null,
    is_returning_student: false,
    birthday_month: 3,
    birthday_day: 1,
    birthday_date: "2027-03-01",
  },
] satisfies BirthdayCalendarProfile[];

describe("birthday components", () => {
  it("sends the home summary to the profile and to the full list", () => {
    renderRoute(() => <HomeBirthdaySummary birthdays={birthdays} />);

    expect(screen.getByRole("heading", { name: "오늘의 생일" })).toBeVisible();
    expect(screen.getByRole("link", { name: /이한별/ })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25",
    );
    expect(screen.getByRole("link", { name: /오늘의 생일/ })).toHaveAttribute(
      "href",
      "/menu/birthdays",
    );
  });

  it("does not render a home summary when nobody has a birthday today", () => {
    const { container } = renderRoute(() => (
      <HomeBirthdaySummary birthdays={[]} />
    ));

    expect(container).toBeEmptyDOMElement();
  });

  it("groups birthdays by month and shows their cohort", () => {
    renderRoute(() => (
      <BirthdayListScreen
        birthdays={birthdayCalendar}
        referenceDate="2026-12-30"
      />
    ));

    expect(screen.getByRole("heading", { name: "12월" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "1월" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "3월" })).toBeVisible();
    expect(screen.getByText("12월 31일")).toBeVisible();
    expect(screen.getByText("1월 1일")).toBeVisible();
    expect(screen.getByRole("link", { name: /김연말/ })).toHaveTextContent(
      "31기",
    );
    expect(screen.getByRole("link", { name: /박새해/ })).toHaveTextContent(
      "28.5기",
    );
    expect(screen.getByText("내일")).toBeVisible();
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual([
      "/profile/year-end-25",
      "/profile/new-year-26",
      "/profile/teacher-spring",
    ]);
  });

  it("shows a returning student in both cohort filters", async () => {
    const { user } = renderRoute(() => (
      <BirthdayListScreen
        birthdays={birthdayCalendar}
        referenceDate="2026-12-30"
      />
    ));

    await user.click(screen.getByRole("button", { name: "28기" }));
    expect(screen.getByRole("link", { name: /박새해/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "29기" }));
    expect(screen.getByRole("link", { name: /박새해/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "교사" }));
    expect(screen.getByRole("link", { name: /최봄/ })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /박새해/ }),
    ).not.toBeInTheDocument();
  });

  it("uses the closest annual birthday for the day difference", () => {
    const distantBirthday = [
      {
        pub_id: "spring-31",
        name: "한봄",
        avatar_path: "profiles/31/avatar.webp",
        cohort: 31,
        is_returning_student: false,
        birthday_month: 3,
        birthday_day: 14,
        birthday_date: "2027-03-14",
      },
    ] satisfies BirthdayCalendarProfile[];

    renderRoute(() => (
      <BirthdayListScreen
        birthdays={distantBirthday}
        referenceDate="2026-08-26"
      />
    ));

    expect(screen.getByText("165일 전")).toBeVisible();
    expect(screen.queryByText("200일 뒤")).not.toBeInTheDocument();
  });

  it("does not repeat a cycle that already fits on one screen", async () => {
    renderRoute(() => (
      <ScrollHost clientHeight={800}>
        <BirthdayListScreen
          birthdays={birthdayCalendar}
          referenceDate="2026-12-30"
        />
      </ScrollHost>
    ));

    // 세 명이면 한 바퀴가 384px이라 800px 화면 안에 다 들어간다. 두 바퀴째를 깔면 같은
    // 사람이 한 화면에 두 번 보인다.
    const hrefs = (await screen.findAllByRole("link")).map((link) =>
      link.getAttribute("href"),
    );

    expect(hrefs).toEqual([
      "/profile/year-end-25",
      "/profile/new-year-26",
      "/profile/teacher-spring",
    ]);
  });

  it("lays down the next cycle when one cycle is taller than the screen", async () => {
    renderRoute(() => (
      <ScrollHost clientHeight={100}>
        <BirthdayListScreen
          birthdays={birthdayCalendar}
          referenceDate="2026-12-30"
        />
      </ScrollHost>
    ));

    const hrefs = (await screen.findAllByRole("link")).map((link) =>
      link.getAttribute("href"),
    );

    expect(hrefs).toEqual([
      "/profile/year-end-25",
      "/profile/new-year-26",
      "/profile/teacher-spring",
      "/profile/year-end-25",
      "/profile/new-year-26",
      "/profile/teacher-spring",
    ]);
  });

  it("shows an empty state when the date range has no birthdays", () => {
    renderRoute(() => (
      <BirthdayListScreen birthdays={[]} referenceDate="2026-08-26" />
    ));

    expect(screen.getByText("등록된 생일이 없습니다.")).toBeVisible();
  });
});
