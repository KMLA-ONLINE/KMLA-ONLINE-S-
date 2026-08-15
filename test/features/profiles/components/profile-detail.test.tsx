import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProfileDetail } from "~/features/profiles";

describe("ProfileDetail", () => {
  it("renders profile information and timeline space", () => {
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
          birthday: null,
          class_no: null,
          dorm_room: null,
          gender: "female",
          phone_number: null,
          student_number: null,
        }}
        isOwnProfile
      />,
    );

    expect(screen.getByRole("heading", { name: "이한별" })).toBeVisible();

    expect(screen.getByText("@hanbyeol-25")).toBeVisible();
    expect(screen.getByText("25기 · 국제 계열")).toBeVisible();
    expect(screen.getByText("내 프로필")).toBeVisible();
    expect(screen.getByText("안녕하세요.")).toBeVisible();
    expect(screen.getByText("정보")).toBeVisible();
    expect(screen.getByText("게시물")).toBeVisible();
    expect(screen.getByText("아직 표시할 게시물이 없습니다.")).toBeVisible();
  });
});
