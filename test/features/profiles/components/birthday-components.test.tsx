import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BirthdayListScreen,
  HomeBirthdaySummary,
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

describe("birthday components", () => {
  it("renders today's birthday profiles above the meal summary destination", () => {
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

  it("lists birthday profiles in date order with a profile destination", () => {
    renderRoute(() => (
      <BirthdayListScreen birthdays={birthdays} referenceDate="2026-08-26" />
    ));

    expect(screen.getByRole("heading", { name: "오늘" })).toBeVisible();
    expect(screen.getByText("8월 26일")).toBeVisible();
    expect(screen.getByRole("link", { name: /이한별/ })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25",
    );
  });

  it("splits the range into today, upcoming, and past sections", () => {
    renderRoute(() => (
      <BirthdayListScreen
        birthdays={[
          { ...birthdays[0], pub_id: "jimin-24", birthday_date: "2026-08-23" },
          ...birthdays,
          { ...birthdays[0], pub_id: "seomin-26", birthday_date: "2026-08-27" },
        ]}
        referenceDate="2026-08-26"
      />
    ));

    expect(
      screen.getByRole("heading", { name: "다가오는 생일" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "지난 생일" })).toBeVisible();
    expect(screen.getByText("내일")).toBeVisible();
    expect(screen.getByText("3일 전")).toBeVisible();
  });

  it("shows an empty state when the date range has no birthdays", () => {
    renderRoute(() => (
      <BirthdayListScreen birthdays={[]} referenceDate="2026-08-26" />
    ));

    expect(screen.getByText("이 기간에 예정된 생일이 없습니다.")).toBeVisible();
  });
});
