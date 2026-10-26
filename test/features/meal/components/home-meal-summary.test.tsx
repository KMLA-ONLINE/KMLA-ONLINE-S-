import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeMealSummary } from "~/features/meal/components/home-meal-summary";
import { renderRoute } from "../../../router";

describe("HomeMealSummary", () => {
  afterEach(() => vi.useRealTimers());

  it("lists menu items in their original order without a date and offers the full meal screen", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-26T12:00:00+09:00"));
    renderRoute(() => (
      <HomeMealSummary
        day={{
          date: "20260826",
          unavailable: false,
          meals: [
            {
              code: "2",
              label: "중식",
              items: [
                { name: "쌀밥", allergens: [] },
                { name: "된장국", allergens: [] },
                { name: "김치", allergens: [] },
              ],
              servings: "",
              calories: "",
              origin: [],
              nutrition: [],
            },
          ],
        }}
      />
    ));

    expect(
      within(screen.getByRole("list", { name: "중식 메뉴" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["쌀밥", "된장국", "김치"]);
    expect(screen.getByRole("link", { name: "급식 보기" })).toHaveAttribute(
      "href",
      "/menu/meal",
    );
    expect(
      within(screen.getByRole("link", { name: "급식 보기" })).getByText("쌀밥"),
    ).toBeVisible();
    expect(screen.queryByText("전체 보기")).not.toBeInTheDocument();
    expect(screen.queryByText("20260826")).not.toBeInTheDocument();
  });

  it.each([
    { time: "08:00", label: "중식", date: "20260826" },
    { time: "14:00", label: "석식", date: "20260826" },
    { time: "19:00", label: "조식", date: "20260827" },
  ])(
    "renders $label at $time without a summary title",
    ({ time, label, date }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`2026-08-26T${time}:00+09:00`));
      const meals = [
        {
          code: "1",
          label: "조식",
          items: [{ name: "조식 메뉴", allergens: [] }],
          servings: "",
          calories: "",
          origin: [],
          nutrition: [],
        },
        {
          code: "2",
          label: "중식",
          items: [{ name: "중식 메뉴", allergens: [] }],
          servings: "",
          calories: "",
          origin: [],
          nutrition: [],
        },
        {
          code: "3",
          label: "석식",
          items: [{ name: "석식 메뉴", allergens: [] }],
          servings: "",
          calories: "",
          origin: [],
          nutrition: [],
        },
      ];

      renderRoute(() => (
        <HomeMealSummary day={{ date, meals, unavailable: false }} />
      ));

      expect(
        screen.queryByRole("heading", { name: /오늘의|내일의/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: label })).toBeVisible();
      expect(screen.getByText(`${label} 메뉴`)).toBeVisible();

      for (const meal of meals) {
        if (meal.label === label) continue;

        expect(screen.queryByText(meal.items[0].name)).not.toBeInTheDocument();
      }
    },
  );
});

describe("HomeMealSummary in English", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("translates the link, the meal name and the empty state", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-26T12:00:00+09:00"));
    const { unmount } = renderRoute(() => (
      <HomeMealSummary
        day={{
          date: "20260826",
          unavailable: false,
          meals: [
            {
              code: "2",
              label: "중식",
              items: [{ name: "쌀밥", allergens: [] }],
              servings: "",
              calories: "",
              origin: [],
              nutrition: [],
            },
          ],
        }}
      />
    ));

    expect(screen.getByRole("link", { name: "View meals" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Lunch" })).toBeVisible();
    expect(screen.getByRole("list", { name: "Lunch menu" })).toBeVisible();
    expect(screen.getByText("쌀밥")).toBeVisible();
    unmount();

    renderRoute(() => <HomeMealSummary day={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn't load meals. Please check again later.",
    );
  });
});
