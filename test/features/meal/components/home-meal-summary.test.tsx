import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomeMealSummary } from "~/features/meal/components/home-meal-summary";
import { getDefaultMeal } from "~/features/meal/data/neis";
import { renderRoute } from "../../../router";

describe("HomeMealSummary", () => {
  it("renders only the meal for the current time", () => {
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
      <HomeMealSummary day={{ date: "20260826", meals, unavailable: false }} />
    ));

    const selectedMeal = getDefaultMeal();
    const selectedItem = meals.find((meal) => meal.label === selectedMeal);

    expect(screen.getByRole("heading", { name: selectedMeal })).toBeVisible();
    expect(screen.getByText(selectedItem?.items[0].name ?? "")).toBeVisible();

    for (const meal of meals) {
      if (meal.label === selectedMeal) continue;

      expect(screen.queryByText(meal.items[0].name)).not.toBeInTheDocument();
    }
  });
});
