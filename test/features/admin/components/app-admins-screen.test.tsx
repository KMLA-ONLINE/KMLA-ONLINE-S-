import { afterEach, describe, expect, it } from "vitest";

import {
  AdminReauthentication,
  AppAdminsScreen,
} from "~/features/admin/components/app-admins-screen";
import type { AdminMember } from "~/features/admin/model/types";
import { renderRoute, screen } from "../../../router";

const admin: AdminMember = {
  profile_id: 1,
  pub_id: "admin",
  name: "관리자",
  profile_type: "teacher",
  cohort: 0,
  department: "교무",
  is_app_admin: true,
  is_self: true,
  total_count: 1,
};

describe("AppAdminsScreen in English", () => {
  afterEach(() => window.localStorage.clear());

  it("renders the roster, search and confirm dialog in English", async () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    const { user } = renderRoute(() => (
      <AppAdminsScreen roster={[admin]} candidates={[]} query="" />
    ));

    expect(screen.getByText("1 app admin")).toBeVisible();
    expect(screen.getByText("Me")).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "Search app admin candidates" }),
    ).toBeVisible();
    expect(
      screen.getByText("Type at least two characters to search."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Remove admin" }));
    expect(
      await screen.findByRole("dialog", { name: "Confirm app admin demotion" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Demote" })).toBeVisible();
  });

  it("renders the password gate in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(() => <AdminReauthentication />);

    expect(screen.getByText("Confirm password")).toBeVisible();
    expect(screen.getByLabelText("Current password")).toBeVisible();
    expect(screen.getByRole("button", { name: "OK" })).toBeVisible();
  });
});
