import { describe, expect, it } from "vitest";

import {
  filterRoster,
  rosterCsv,
  rosterGroups,
  rosterTypeCounts,
  type RosterFilter,
} from "~/features/admin/model/roster";
import type { RosterMember } from "~/features/admin/model/types";

function member(overrides: Partial<RosterMember>): RosterMember {
  return {
    profile_id: 1,
    pub_id: "member",
    name: "이름",
    profile_type: "student",
    cohort: 30,
    department: null,
    is_app_admin: false,
    approved_at: "2026-03-01T00:00:00+00:00",
    ...overrides,
  };
}

const members = [
  member({
    profile_id: 1,
    pub_id: "kim30",
    name: "김학생",
    cohort: 30,
    department: "학생회",
  }),
  member({
    profile_id: 2,
    pub_id: "lee29",
    name: "이학생",
    cohort: 29,
    approved_at: "2026-05-01T00:00:00+00:00",
  }),
  member({
    profile_id: 3,
    pub_id: "park20",
    name: "박졸업",
    profile_type: "alumni",
    cohort: 20,
  }),
  member({
    profile_id: 4,
    pub_id: "choi-t",
    name: "최선생",
    profile_type: "teacher",
    cohort: null,
    is_app_admin: true,
  }),
  member({
    profile_id: 5,
    pub_id: "jung-t",
    name: "정선생",
    profile_type: "teacher",
    cohort: null,
  }),
];

const all: RosterFilter = { type: "all", group: null, query: "", sort: "name" };

describe("roster", () => {
  it("counts members by type", () => {
    expect(rosterTypeCounts(members)).toEqual({
      all: 5,
      student: 2,
      alumni: 1,
      teacher: 2,
    });
  });

  it("groups students and alumni by newest cohort", () => {
    expect(rosterGroups(members, "all").map((group) => group.label)).toEqual([
      "30기",
      "29기",
      "20기",
    ]);
    expect(rosterGroups(members, "student")).toEqual([
      { key: "30", label: "30기", count: 1 },
      { key: "29", label: "29기", count: 1 },
    ]);
    expect(rosterGroups(members, "teacher")).toEqual([]);
  });

  it("filters by type, group and search text", () => {
    const names = (filter: Partial<RosterFilter>) =>
      filterRoster(members, { ...all, ...filter }).map((row) => row.name);

    expect(names({ type: "student", group: "29" })).toEqual(["이학생"]);
    expect(names({ query: "학생회" })).toEqual(["김학생"]);
    expect(names({ query: "PARK" })).toEqual(["박졸업"]);
  });

  it("sorts by name, newest cohort or latest approval", () => {
    const names = (sort: RosterFilter["sort"]) =>
      filterRoster(members, { ...all, sort }).map((row) => row.name);

    expect(names("name")).toEqual([
      "김학생",
      "박졸업",
      "이학생",
      "정선생",
      "최선생",
    ]);
    expect(names("cohort").slice(0, 3)).toEqual(["김학생", "이학생", "박졸업"]);
    expect(names("approved")[0]).toBe("이학생");
  });

  it("writes an Excel-safe CSV", () => {
    const csv = rosterCsv([
      member({ name: '=HYPERLINK("x")', department: "a,b" }),
    ]);
    const [header, row] = csv.slice(1).trimEnd().split("\r\n");

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(header).toBe("이름,공개 ID,유형,기수,부서,앱 관리자,승인 시각");
    expect(row).toBe(
      `"'=HYPERLINK(""x"")",member,재학생,30,"a,b",,2026-03-01T00:00:00+00:00`,
    );
  });
});
