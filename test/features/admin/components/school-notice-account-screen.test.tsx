import { afterEach, describe, expect, it } from "vitest";

import { SchoolNoticeAccountScreen } from "~/features/admin/components/school-notice-account-screen";
import type { SchoolNoticeStatus } from "~/features/admin/model/types";
import { renderRoute, screen } from "../../../router";

const status: SchoolNoticeStatus = {
  sync_configured: true,
  account_configured: false,
  login_id: null,
  account_updated_at: null,
  notice_count: 0,
  last_requested_at: null,
  last_attempt_at: null,
  last_success_at: null,
  last_error: null,
  last_error_at: null,
};

describe("SchoolNoticeAccountScreen in English", () => {
  afterEach(() => window.localStorage.clear());

  it("renders the status card and account form in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(() => <SchoolNoticeAccountScreen status={status} />);

    expect(
      screen.getByRole("button", { name: "Refresh status" }),
    ).toBeVisible();
    expect(screen.getByText("Enter the school account")).toBeVisible();
    expect(screen.getByText("Stored notices")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeVisible();
    expect(screen.getByText("Change school account")).toBeVisible();
    expect(screen.getByLabelText("School ID")).toBeVisible();
    expect(screen.getByLabelText("School password")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
  });
});
