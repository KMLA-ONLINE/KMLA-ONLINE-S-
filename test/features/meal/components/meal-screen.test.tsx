import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MealScreen } from "~/features/meal/components/meal-screen";
import { getDefaultMeal, type MealDay } from "~/features/meal/data/neis";
import { renderRoute } from "../../../router";

function dayWith(items: MealDay["meals"][number]["items"]): MealDay {
  return {
    date: "20260826",
    unavailable: false,
    meals: [
      {
        code: "1",
        label: getDefaultMeal(),
        items,
        servings: "",
        calories: "",
        origin: [],
        nutrition: [],
      },
    ],
  };
}

function dish(name: string) {
  const item = screen
    .getAllByRole("listitem")
    .find((li) => li.textContent?.startsWith(name));
  if (!item) throw new Error(`no dish ${name}`);
  return item;
}

function renderMeal(day: MealDay) {
  renderRoute(() => (
    <MealScreen dates={[day.date]} initialDate={day.date} initialDay={day} />
  ));
}

describe("MealScreen allergens", () => {
  it("shows allergen numbers beside each dish and a legend for them", () => {
    renderMeal(
      dayWith([
        { name: "돈육김치찌개", allergens: ["5", "9", "10"] },
        { name: "쌀밥", allergens: [] },
        { name: "우유", allergens: ["2"] },
      ]),
    );

    const stew = dish("돈육김치찌개");
    expect(within(stew).getByText("5·9·10")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // 번호는 화면용이고 보조기기에는 이름을 읽힌다.
    expect(stew).toHaveTextContent("알레르기: 대두, 새우, 돼지고기");
    expect(dish("쌀밥")).toHaveTextContent(/^쌀밥$/);

    const legend = screen.getByRole("list", { name: "알레르기 유발 식품" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["2 우유", "5 대두", "9 새우", "10 돼지고기"]);
  });

  it("omits the legend when no dish lists allergens", () => {
    renderMeal(dayWith([{ name: "쌀밥", allergens: [] }]));

    expect(
      screen.queryByRole("list", { name: "알레르기 유발 식품" }),
    ).not.toBeInTheDocument();
  });
});
