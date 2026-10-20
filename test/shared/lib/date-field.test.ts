import { describe, expect, it } from "vitest";

import {
  daysInMonth,
  isCompleteDate,
  joinDateParts,
  readDateField,
  splitDateValue,
} from "~/shared/lib/date-field";

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

describe("date field", () => {
  it("splits and rejoins an ISO date", () => {
    expect(splitDateValue("2009-03-01")).toEqual({
      year: "2009",
      month: "03",
      day: "01",
    });
    expect(joinDateParts({ year: "2009", month: "3", day: "1" })).toBe(
      "2009-03-01",
    );
  });

  it("treats a malformed value as empty", () => {
    expect(splitDateValue("2009/03/01")).toEqual({
      year: "",
      month: "",
      day: "",
    });
    expect(joinDateParts({ year: "", month: "", day: "" })).toBe("");
  });

  // 고르다 만 날짜를 빈 값으로 바꾸면 받는 쪽이 "입력 안 함"과 구분하지 못한다.
  it("keeps a partly chosen date incomplete instead of empty", () => {
    const partial = joinDateParts({ year: "2009", month: "3", day: "" });

    expect(partial).not.toBe("");
    expect(isCompleteDate(partial)).toBe(false);
    expect(splitDateValue(partial)).toEqual({
      year: "2009",
      month: "03",
      day: "",
    });
    expect(isCompleteDate("2009-03-01")).toBe(true);
  });

  it("counts the days of a month, leap years included", () => {
    expect(daysInMonth("2009", "02")).toBe(28);
    expect(daysInMonth("2008", "02")).toBe(29);
    expect(daysInMonth("2009", "04")).toBe(30);
    // 연도를 아직 고르지 않았다면 2월 29일도 남겨 둔다.
    expect(daysInMonth("", "02")).toBe(29);
    expect(daysInMonth("2009", "")).toBe(31);
  });

  it("reads the three selects back as one date", () => {
    expect(
      readDateField(
        form({ birthdayYear: "2009", birthdayMonth: "03", birthdayDay: "01" }),
        "birthday",
      ),
    ).toBe("2009-03-01");

    expect(readDateField(form({}), "birthday")).toBe("");
  });
});
