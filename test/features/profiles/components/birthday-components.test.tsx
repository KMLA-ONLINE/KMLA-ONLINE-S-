import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BirthdayListScreen,
  HomeBirthdaySummary,
  type BirthdayCalendarProfile,
  type BirthdayProfile,
} from "~/features/profiles";
import { renderRoute } from "../../../router";

const birthdays = [
  {
    pub_id: "hanbyeol-25",
    name: "이한별",
    avatar_path: "profiles/25/avatar.webp",
    avatar_url: "https://example.com/hanbyeol.webp",
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
    birthday_month: 12,
    birthday_day: 31,
    birthday_date: "2026-12-31",
  },
  {
    pub_id: "new-year-26",
    name: "박새해",
    avatar_path: "profiles/26/avatar.webp",
    birthday_month: 1,
    birthday_day: 1,
    birthday_date: "2027-01-01",
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

  it("keeps December and January together in birthday order", () => {
    renderRoute(() => (
      <BirthdayListScreen
        birthdays={birthdayCalendar}
        referenceDate="2026-12-30"
      />
    ));

    expect(screen.getByRole("heading", { name: "생일 순서" })).toBeVisible();
    expect(screen.getByText("12월 31일")).toBeVisible();
    expect(screen.getByText("1월 1일")).toBeVisible();
    expect(screen.getByText("내일")).toBeVisible();
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/profile/year-end-25", "/profile/new-year-26"]);
  });

  it("shows an empty state when the date range has no birthdays", () => {
    renderRoute(() => (
      <BirthdayListScreen birthdays={[]} referenceDate="2026-08-26" />
    ));

    expect(screen.getByText("등록된 생일이 없습니다.")).toBeVisible();
  });
});
