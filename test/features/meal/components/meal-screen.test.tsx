import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { MealScreen } from "~/features/meal/components/meal-screen";
import { getDefaultMeal, type MealDay } from "~/features/meal/data/neis";
import { renderRoute } from "../../../router";

const LEGEND = { name: "알레르기 유발 식품" };
const TOGGLE = { name: "알레르기 표시" };

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
  return renderRoute(() => (
    <MealScreen dates={[day.date]} initialDate={day.date} initialDay={day} />
  ));
}

const STEW_DAY = dayWith([
  { name: "돈육김치찌개", allergens: ["5", "9", "10"] },
  { name: "쌀밥", allergens: [] },
  { name: "우유", allergens: ["2"] },
]);

afterEach(() => {
  window.localStorage.clear();
});

describe("MealScreen allergens", () => {
  it("hides allergen info until the toggle is turned on", () => {
    renderMeal(STEW_DAY);

    expect(screen.getByRole("switch", TOGGLE)).not.toBeChecked();
    expect(dish("돈육김치찌개")).toHaveTextContent(/^돈육김치찌개$/);
    expect(screen.queryByRole("list", LEGEND)).not.toBeInTheDocument();
  });

  it("shows allergen numbers per dish and a legend when turned on", async () => {
    renderMeal(STEW_DAY);
    await userEvent.click(screen.getByRole("switch", TOGGLE));

    const stew = dish("돈육김치찌개");
    expect(within(stew).getByText("5·9·10")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // 번호는 화면용이고 보조기기에는 이름을 읽힌다.
    expect(stew).toHaveTextContent("알레르기: 대두, 새우, 돼지고기");
    expect(dish("쌀밥")).toHaveTextContent(/^쌀밥$/);

    const legend = screen.getByRole("list", LEGEND);
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["2 우유", "5 대두", "9 새우", "10 돼지고기"]);
  });

  it("remembers the toggle on this device", async () => {
    const { unmount } = renderMeal(STEW_DAY);
    await userEvent.click(screen.getByRole("switch", TOGGLE));
    unmount();

    renderMeal(STEW_DAY);

    expect(await screen.findByRole("list", LEGEND)).toBeVisible();
  });

  it("omits the legend when no dish lists allergens", async () => {
    renderMeal(dayWith([{ name: "쌀밥", allergens: [] }]));
    await userEvent.click(screen.getByRole("switch", TOGGLE));

    expect(screen.queryByRole("list", LEGEND)).not.toBeInTheDocument();
  });
});
