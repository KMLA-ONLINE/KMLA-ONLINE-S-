import { afterEach, describe, expect, it } from "vitest";

import { GongangManagersScreen } from "~/features/admin/components/gongang-managers-screen";
import type { AcceptedUser } from "~/features/admin/model/types";
import { renderRoute, screen } from "../../../router";

const candidate: AcceptedUser = {
  profile_id: 2,
  pub_id: "cand",
  name: "후보",
  profile_type: "student",
  cohort: 31,
  department: "",
  has_gongang_manage: false,
  total_count: 1,
};

describe("GongangManagersScreen in English", () => {
  afterEach(() => window.localStorage.clear());

  it("renders headings, empty state and actions in English", async () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    const { user } = renderRoute(() => (
      <GongangManagersScreen
        managers={[]}
        candidates={[candidate]}
        query="후보"
      />
    ));

    expect(screen.getByText("0 current managers")).toBeVisible();
    expect(screen.getByText("No free period managers yet.")).toBeVisible();
    expect(screen.getByText("Search candidates")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Grant access" }));
    expect(
      await screen.findByRole("dialog", {
        name: "Grant free period management",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Grant" })).toBeVisible();
  });
});
