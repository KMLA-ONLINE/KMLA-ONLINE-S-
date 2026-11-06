import { describe, expect, it } from "vitest";

import {
  pasteCourse,
  pasteSemester,
  type TimetableCourse,
} from "~/features/timetable/model/timetable";

const math: TimetableCourse = {
  id: "math",
  name: "수학",
  color: 3,
  room: "301",
  meetings: [
    { id: "m1", day: 0, start: 1, end: 2 },
    { id: "m2", day: 2, start: 5, end: 5 },
  ],
};

const english: TimetableCourse = {
  id: "english",
  name: "영어",
  color: 5,
  room: "",
  meetings: [{ id: "e1", day: 1, start: 3, end: 3 }],
};

describe("pasteCourse", () => {
  it("같은 요일·교시에 새 id로 붙여 넣는다", () => {
    const result = pasteCourse([english], math);

    if (!("courses" in result)) {
      throw new Error("겹치지 않는데 붙여 넣지 못했다");
    }
    const pasted = result.courses;
    expect(pasted).toHaveLength(2);
    const copy = pasted[1];
    expect(copy).toMatchObject({ name: "수학", color: 3, room: "301" });
    expect(
      copy.meetings.map(({ day, start, end }) => [day, start, end]),
    ).toEqual([
      [0, 1, 2],
      [2, 5, 5],
    ]);
    // 원본과 같은 학기에 다시 붙여도 id가 겹치지 않게 새로 만든다.
    expect(copy.id).not.toBe("math");
    expect(copy.meetings.map((meeting) => meeting.id)).not.toContain("m1");
  });

  it("겹치는 수업이 있으면 붙여 넣지 않고 겹치는 수업을 알려 준다", () => {
    const busy: TimetableCourse = {
      ...english,
      meetings: [{ id: "e1", day: 0, start: 2, end: 2 }],
    };
    expect(pasteCourse([english, busy], math)).toEqual({ conflict: busy });
  });
});

describe("pasteSemester", () => {
  it("복사한 학기의 수업을 새 id로 통째로 바꿔 넣는다", () => {
    const pasted = pasteSemester([math, english]);

    expect(pasted.map((course) => course.name)).toEqual(["수학", "영어"]);
    expect(pasted.map((course) => course.id)).not.toContain("math");
    expect(pasted[0].meetings[0].id).not.toBe("m1");
  });
});
