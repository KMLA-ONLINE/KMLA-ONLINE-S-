import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProfileDetail } from "~/features/profiles";

describe("ProfileDetail", () => {
  it("renders accepted identity and its canonical profile link", () => {
    render(
      <ProfileDetail
        profile={{
          pub_id: "hanbyeol-25",
          name: "이한별",
          type: "alumni",
          role: "member",
          cohort: 25,
          academic_track: "international",
          avatar_path: null,
          description: "안녕하세요.",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "이한별" })).toBeVisible();
    expect(screen.getByText("졸업생 · 25기 · 국제 계열")).toBeVisible();
    expect(screen.getByText("승인됨")).toBeVisible();
    expect(screen.getByText("/profile/hanbyeol-25")).toBeVisible();
  });
});
