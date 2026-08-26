import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProfileDetail } from "~/features/profiles";
import { renderRoute } from "../../../router";

let restoreDimensions: (() => void) | undefined;

afterEach(() => {
  restoreDimensions?.();
  restoreDimensions = undefined;
});

describe("ProfileDetail", () => {
  it("renders profile information, edit link, and timeline space", () => {
    renderRoute(() => (
      <ProfileDetail
        profile={{
          id: 25,
          pub_id: "hanbyeol-25",
          name: "이한별",
          type: "alumni",
          role: "admin",
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
    expect(screen.getByText("관리자")).toBeVisible();
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
    expect(screen.queryByText("앱 관리자")).not.toBeInTheDocument();
  });

  it("expands an overflowing description on demand", async () => {
    const scrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const clientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 80,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 60,
    });
    restoreDimensions = () => {
      if (scrollHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          scrollHeight,
        );
      }
      if (clientHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientHeight",
          clientHeight,
        );
      }
    };

    const description = "소개 첫 줄\n소개 둘째 줄\n소개 셋째 줄\n소개 넷째 줄";
    const { user } = renderRoute(() => (
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
          description,
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

    const descriptionElement = screen.getByText(/소개 첫 줄/);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "더보기" })).toBeVisible();
    });
    expect(descriptionElement).toHaveClass("line-clamp-3");

    await user.click(screen.getByRole("button", { name: "더보기" }));

    expect(descriptionElement).not.toHaveClass("line-clamp-3");
    expect(screen.getByRole("button", { name: "접기" })).toBeVisible();
  });
});
