import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GongangBoard } from "~/features/school-utilities/components/gongang-board";

describe("gongang availability", () => {
  it.each(["2026-10-14", "2026-10-17"])(
    "shows the reason below the applicant on %s",
    (date) => {
      render(
        <GongangBoard
          date={date}
          floorId="floor_b1"
          onFloorChange={vi.fn()}
          selected={[]}
          entries={[
            {
              slot: "study-1",
              location: "floor_b1",
              state: "reserved",
              label: "홍길동",
              detail: "합주 연습",
              recurring: false,
            },
          ]}
          onSelect={vi.fn()}
        />,
      );
      const reservation = screen.getByRole("button", {
        name: "1자습 지하 1층 홍길동",
      });
      expect(reservation).toHaveTextContent(/홍길동\s*합주 연습/);
      expect(within(reservation).getByText("합주 연습")).toBeVisible();
    },
  );

  it("shows all five weekday periods across the four floors without time tabs", async () => {
    const onSelect = vi.fn();
    render(
      <GongangBoard
        date="2026-10-14"
        floorId="floor_b1"
        onFloorChange={vi.fn()}
        selected={[]}
        entries={[]}
        onSelect={onSelect}
      />,
    );
    const table = screen.getByRole("table", { name: "공강 예약" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["시간", "지하 1층", "2층", "4층", "10층"]);
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual(["점심", "저녁", "1자습", "혼정끝", "2자습"]);
    await userEvent.click(
      screen.getByRole("button", { name: "점심 지하 1층 선택" }),
    );
    expect(onSelect).toHaveBeenCalledWith("lunch", "floor_b1");
  });
});
