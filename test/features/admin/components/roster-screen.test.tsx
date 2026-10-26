import { afterEach, describe, expect, it } from "vitest";

import { RosterScreen } from "~/features/admin/components/roster-screen";
import type { RosterMember } from "~/features/admin/model/types";
import { renderRoute, screen } from "../../../router";

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
    is_suspended: false,
    suspension_expires_at: null,
    ...overrides,
  };
}

const members = [
  member({ profile_id: 1, pub_id: "kim30", name: "김학생", cohort: 30 }),
  member({ profile_id: 2, pub_id: "lee29", name: "이학생", cohort: 29 }),
  member({
    profile_id: 3,
    pub_id: "choi-t",
    name: "최선생",
    profile_type: "teacher",
    cohort: null,
    is_app_admin: true,
  }),
  member({
    profile_id: 4,
    pub_id: "stop",
    name: "정지중",
    is_suspended: true,
  }),
];

describe("RosterScreen", () => {
  it("lists approved members with Korean chrome by default", () => {
    renderRoute(() => <RosterScreen members={members} />);

    expect(screen.getByText("승인된 사용자 4명")).toBeVisible();
    expect(screen.getByRole("button", { name: "전체 4" })).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "사용자 검색" }),
    ).toBeVisible();
  });
});

describe("RosterScreen in English", () => {
  afterEach(() => window.localStorage.clear());

  it("renders counts, filters, badges and the empty state in English", async () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    const { user } = renderRoute(() => <RosterScreen members={members} />);

    expect(screen.getByText("4 approved users")).toBeVisible();
    expect(screen.getByRole("button", { name: "All 4" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Current student 3" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Suspended 1" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Cohort" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cohort 30 2" })).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "Search users" }),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveDisplayValue(
      "By name",
    );
    expect(screen.getByText("App admin")).toBeVisible();
    expect(screen.getByText("Suspended · indefinitely")).toBeVisible();
    expect(screen.getByText(/No cohort/)).toBeVisible();
    expect(screen.getAllByText(/No department/)[0]).toBeVisible();

    await user.type(
      screen.getByRole("searchbox", { name: "Search users" }),
      "zzz",
    );
    expect(screen.getByText("No users match these filters.")).toBeVisible();
  });
});
