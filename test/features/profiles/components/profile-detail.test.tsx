import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProfileDetail } from "~/features/profiles";
import { renderRoute } from "../../../router";

describe("ProfileDetail", () => {
  it("renders profile information, edit link, and timeline space", () => {
    renderRoute(() => (
      <ProfileDetail
        profile={{
          id: 25,
          pub_id: "hanbyeol-25",
          name: "이한별",
          type: "alumni",
          role: "member",
          cohort: 25,
          academic_track: "international",
          avatar_path: null,
          avatar_url: null,
          cover_path: null,
          cover_url: null,
          description: "안녕하세요.",
          birthday: null,
          class_no: null,
          dorm_room: null,
          department: null,
          gender: "female",
          phone_number: null,
          contact_email: "hanbyeol@example.com",
          student_number: null,
          allow_timeline_posts: true,
          is_returning_student: false,
        }}
        isOwnProfile
        viewerName="이한별"
        viewerAvatarUrl={null}
        posts={{ posts: [], nextCursor: null }}
      />
    ));

    expect(screen.getByRole("heading", { name: "이한별" })).toBeVisible();
    expect(screen.queryByText("@hanbyeol-25")).not.toBeInTheDocument();
    expect(screen.getByText("25기 · 국제 계열")).toBeVisible();
    expect(screen.getByText("안녕하세요.")).toBeVisible();
    expect(screen.getByText("정보")).toBeVisible();
    expect(screen.getByText("게시물")).toBeVisible();
    expect(screen.getByText("hanbyeol@example.com")).toBeVisible();
    expect(screen.getByRole("link", { name: "프로필 편집" })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25/edit",
    );
    expect(screen.getByText("아직 게시물이 없습니다")).toBeVisible();
    expect(screen.getByRole("link", { name: "글쓰기…" })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25/posts/new",
    );
  });

  it("does not reuse the avatar as a missing cover image", () => {
    const avatarUrl = "https://example.com/avatar.webp";

    renderRoute(() => (
      <ProfileDetail
        profile={{
          id: 25,
          pub_id: "hanbyeol-25",
          name: "이한별",
          type: "alumni",
          role: "member",
          cohort: 25,
          academic_track: "international",
          avatar_path: "profiles/25/avatar.webp",
          avatar_url: avatarUrl,
          cover_path: null,
          cover_url: null,
          description: null,
          birthday: null,
          class_no: null,
          dorm_room: null,
          department: null,
          gender: "female",
          phone_number: null,
          contact_email: null,
          student_number: null,
          allow_timeline_posts: true,
          is_returning_student: false,
        }}
        isOwnProfile={false}
        viewerName="김관리"
        viewerAvatarUrl={null}
        posts={{ posts: [], nextCursor: null }}
      />
    ));

    expect(
      within(screen.getByTestId("profile-cover")).queryByRole("img", {
        hidden: true,
      }),
    ).not.toBeInTheDocument();
  });
});
