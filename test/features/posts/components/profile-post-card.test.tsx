import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfilePostCard } from "~/features/posts/components/profile-post-card";
import { profilePost } from "../profile-post-fixture";
import { renderRoute } from "../../../router";

/**
 * jsdom은 레이아웃을 계산하지 않아 모든 높이가 0이다. "더 보기"는 본문이 실제로
 * 잘렸는지를 측정해서 결정하므로, 그 측정값만 가짜로 넣어준다.
 */
function stubOverflow(overflowing: boolean) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
    overflowing ? 400 : 60,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(66);
}

function renderCard(post = profilePost()) {
  return renderRoute(() => <ProfilePostCard post={post} onDelete={vi.fn()} />);
}

afterEach(() => vi.restoreAllMocks());

describe("ProfilePostCard", () => {
  it("names both the author and the timeline owner on a guest post", () => {
    stubOverflow(false);
    renderCard();

    expect(screen.getByRole("link", { name: "김서민" })).toHaveAttribute(
      "href",
      "/profile/seomin-30",
    );
    expect(
      screen.getByRole("link", { name: "이지은님의 타임라인" }),
    ).toHaveAttribute("href", "/profile/jieun-29");
  });

  it("names the author once on their own timeline", () => {
    stubOverflow(false);
    renderCard(
      profilePost({
        author_pub_id: "jieun-29",
        author_name: "이지은",
        timeline_pub_id: "jieun-29",
        timeline_name: "이지은",
      }),
    );

    expect(
      screen.queryByRole("link", { name: "이지은님의 타임라인" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "이지은" })).toHaveLength(1);
  });

  it("marks a private post", () => {
    stubOverflow(false);
    renderCard(profilePost({ visibility: "private" }));

    expect(screen.getByText("비공개")).toBeVisible();
  });

  it("does not mark a public post", () => {
    stubOverflow(false);
    renderCard();

    expect(screen.queryByText("비공개")).not.toBeInTheDocument();
  });

  it("sends the comment count to the post detail under the timeline owner", () => {
    stubOverflow(false);
    renderCard(profilePost({ comment_count: 3 }));

    expect(screen.getByRole("link", { name: "댓글 3개" })).toHaveAttribute(
      "href",
      "/profile/jieun-29/posts/post-id",
    );
  });

  it("offers no menu without edit or delete rights", () => {
    stubOverflow(false);
    renderCard();

    expect(
      screen.queryByRole("button", { name: "게시물 옵션" }),
    ).not.toBeInTheDocument();
  });

  it("never offers pinning, which belongs to group posts", async () => {
    stubOverflow(false);
    const { user } = renderCard(
      profilePost({ can_edit: true, can_delete: true }),
    );

    await user.click(screen.getByRole("button", { name: "게시물 옵션" }));

    expect(await screen.findByRole("menuitem", { name: "수정" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "삭제" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "고정" }),
    ).not.toBeInTheDocument();
  });

  it("falls back to a placeholder when the author account is gone", () => {
    stubOverflow(false);
    renderCard(profilePost({ author_name: null, author_pub_id: null }));

    expect(screen.getByText("알 수 없는 사용자")).toBeVisible();
  });

  it.each([
    ["avatar_changed", "프로필 사진을", "프로필 사진", "aspect-square"],
    ["cover_changed", "프로필 커버를", "프로필 커버", "aspect-[3/1]"],
  ] as const)(
    "renders a %s activity instead of a regular post body",
    (activityKind, phrase, imageLabel, aspectClass) => {
      renderCard(
        profilePost({
          activity_kind: activityKind,
          activity_media_path: "1/media/image-id",
          activity_media_url: "https://example.com/activity.webp",
          body: "표시하면 안 되는 본문",
          author_name: "홍길동",
          author_pub_id: "gildong-30",
          timeline_name: "홍길동",
          timeline_pub_id: "gildong-30",
        }),
      );

      expect(
        screen.getByText(new RegExp(`님이 ${phrase} 바꾸었습니다`)),
      ).toBeVisible();
      const image = screen.getByRole("img", {
        name: `홍길동님이 변경한 ${imageLabel}`,
      });
      expect(image).toHaveAttribute("src", "https://example.com/activity.webp");
      expect(screen.getByTestId("profile-media-activity")).toHaveClass(
        aspectClass,
      );
      expect(screen.queryByTestId("profile-post-body")).not.toBeInTheDocument();
    },
  );

  it("opens a profile activity image in the image viewer", async () => {
    const { user } = renderCard(
      profilePost({
        activity_kind: "avatar_changed",
        activity_media_path: "1/avatar/image-id",
        activity_media_url: "https://example.com/activity.webp",
        author_name: "홍길동",
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "프로필 사진 크게 보기" }),
    );

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("link", { name: "다운로드" })).toHaveAttribute(
      "href",
      "https://example.com/activity.webp",
    );
  });
});
