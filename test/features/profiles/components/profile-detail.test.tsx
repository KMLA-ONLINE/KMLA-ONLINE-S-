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
  it("shows the owner their edit and write destinations, not their public id", () => {
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

    // 공개 ID는 주소에만 쓰고 화면에는 드러내지 않는다(기능 명세 §12.1).
    expect(screen.queryByText("@hanbyeol-25")).not.toBeInTheDocument();
    // 기수와 계열은 한 줄로 합쳐 낸다.
    expect(screen.getByText("25기 · 국제 계열")).toBeVisible();
    expect(screen.getByRole("link", { name: "프로필 편집" })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25/edit",
    );
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
    expect(descriptionElement).toHaveClass("line-clamp-2");

    await user.click(screen.getByRole("button", { name: "더보기" }));

    expect(descriptionElement).not.toHaveClass("line-clamp-2");
    expect(screen.getByRole("button", { name: "접기" })).toBeVisible();
  });

  it("masks contact details until each one is revealed", async () => {
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
          description: null,
          birthday: null,
          class_no: null,
          dorm_room: null,
          department: null,
          gender: null,
          phone_number: "010-1234-5678",
          contact_email: "hanbyeol@example.com",
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

    // 값은 응답에 그대로 있지만 한눈에 읽히지는 않는다(기능 명세 §12.1).
    expect(screen.queryByText("010-1234-5678")).not.toBeInTheDocument();
    expect(screen.getByText("•••-••••-5678")).toBeVisible();
    expect(screen.getByText("ha•••@example.com")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "전화번호 보기" }));

    expect(screen.getByRole("link", { name: "010-1234-5678" })).toHaveAttribute(
      "href",
      "tel:01012345678",
    );
    // 한 항목을 열어도 다른 항목은 가려진 채로 남는다.
    expect(screen.getByRole("button", { name: "이메일 보기" })).toBeVisible();
  });

  it("collapses every fact group after the first on narrow screens", async () => {
    const { user } = renderRoute(() => (
      <ProfileDetail
        profile={{
          id: 25,
          pub_id: "hanbyeol-25",
          name: "이한별",
          type: "student",
          role: "member",
          cohort: 25,
          academic_track: "international",
          avatar_path: null,
          avatar_url: null,
          cover_path: null,
          cover_url: null,
          description: null,
          birthday: null,
          class_no: 3,
          dorm_room: null,
          department: null,
          gender: null,
          phone_number: "010-1234-5678",
          contact_email: null,
          student_number: "20250101",
          allow_timeline_posts: true,
          is_returning_student: false,
        }}
        isOwnProfile={false}
        viewerName="김관리"
        viewerAvatarUrl={null}
        posts={{ posts: [], nextCursor: null }}
      />
    ));

    // 첫 묶음은 항상 남고 나머지만 접힌다(기능 명세 §12.1).
    expect(screen.getByRole("group", { name: "학적 정보" })).not.toHaveClass(
      "hidden",
    );
    const contact = screen.getByRole("group", { name: "연락처" });
    expect(contact).toHaveClass("hidden");

    await user.click(screen.getByRole("button", { name: "정보 더 보기" }));

    expect(contact).not.toHaveClass("hidden");
    expect(screen.getByRole("button", { name: "접기" })).toBeVisible();
  });
});
