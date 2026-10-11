import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getKoreaYear } from "~/shared/lib/date-field";
import { DateSelect } from "~/shared/ui/date-select";

function fields() {
  const [year, month, day] = screen.getAllByRole("combobox");
  return { year, month, day };
}

describe("DateSelect", () => {
  it("prefills a saved date", () => {
    render(<DateSelect name="birthday" defaultValue="2009-03-01" />);
    const { year, month, day } = fields();

    expect(year).toHaveValue("2009");
    expect(month).toHaveValue("03");
    expect(day).toHaveValue("01");
  });

  it("opens the year list up to a saved value newer than the default start", () => {
    // 저장된 값이 기본 시작 연도보다 최근이면 목록이 거기까지 열려야 한다. 그러지 않으면
    // 저장된 연도만 외딴섬으로 떠서 그 위쪽 연도로는 고칠 수가 없다.
    const thisYear = getKoreaYear();
    render(<DateSelect name="birthday" defaultValue={`${thisYear}-11-30`} />);
    const { year } = fields();
    const options = within(year).getAllByRole("option");

    expect(year).toHaveValue(String(thisYear));
    expect(options[1]).toHaveTextContent(`${thisYear}년`);
    expect(options[2]).toHaveTextContent(`${thisYear - 1}년`);
  });

  it("starts empty with no saved value", () => {
    render(<DateSelect name="birthday" />);
    const { year, month, day } = fields();

    expect(year).toHaveValue("");
    expect(month).toHaveValue("");
    expect(day).toHaveValue("");
  });
});
