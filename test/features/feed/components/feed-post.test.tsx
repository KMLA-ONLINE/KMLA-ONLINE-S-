import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FeedPostCard,
  FeedPostRow,
} from "~/features/feed/components/feed-post";
import type {
  GroupFeedPost,
  ProfileFeedPost,
} from "~/features/feed/model/types";
import { groupPost } from "../../posts/group-post-fixture";
import { renderRoute } from "../../../router";

function staffFeedPost(): GroupFeedPost {
  const { is_pinned: _pinned, ...post } = groupPost({
    author_identity: "staff",
    category_name: "필독",
    title: "중요 공지",
  });
  return {
    ...post,
    kind: "group",
    feed_epoch: "2026-08-24T08:00:00Z",
    feed_position: 1,
    rank_time: "2026-08-24T07:00:00Z",
    group_name: "공지사항",
    group_slug: "notice",
    timeline_name: null,
    timeline_pub_id: null,
    activity_kind: null,
    activity_media_path: null,
    activity_media_url: null,
    visibility: null,
  };
}

function profileActivity(): ProfileFeedPost {
  return {
    ...staffFeedPost(),
    kind: "profile",
    post_id: "11111111-1111-4111-8111-111111111111",
    group_id: null,
    group_name: null,
    group_slug: null,
    category_name: null,
    title: null,
    timeline_name: "김서민",
    timeline_pub_id: "seomin-30",
    activity_kind: "avatar_changed",
    activity_media_path: "activity/avatar.webp",
    activity_media_url: "https://example.test/avatar.webp",
    visibility: "public",
    author_name: "김서민",
    author_pub_id: "seomin-30",
  };
}

afterEach(() => vi.restoreAllMocks());

describe("FeedPostCard", () => {
  it("offers no hide action on the caller's own profile activity", async () => {
    const post = { ...profileActivity(), is_author: true };
    const { user } = renderRoute(() => (
      <FeedPostCard post={post} onHide={vi.fn()} />
    ));

    await user.click(screen.getByRole("button", { name: "게시물 옵션" }));
    expect(
      await screen.findByRole("menuitem", { name: "삭제" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "가리기" }),
    ).not.toBeInTheDocument();
  });

  it("hides someone else's profile activity from the post menu", async () => {
    const onHide = vi.fn();
    const { user } = renderRoute(() => (
      <FeedPostCard post={profileActivity()} onHide={onHide} />
    ));

    await user.click(screen.getByRole("button", { name: "게시물 옵션" }));
    await user.click(await screen.findByRole("menuitem", { name: "가리기" }));

    expect(onHide).toHaveBeenCalledOnce();
  });

  it("shows the body and reserves image space while signing is pending", () => {
    const post = staffFeedPost();
    post.body = "서명을 기다리지 않는 본문";
    post.attachments = [
      {
        attachment_id: "photo",
        post_id: post.post_id,
        storage_bucket: "post-attachments",
        object_path: "post/photo",
        original_filename: "photo.webp",
        position: 0,
        mime_type: "image/webp",
        size_bytes: 10,
        width: 900,
        height: 1200,
        signedUrl: null,
        thumbnail_path: null,
        thumbnailUrl: null,
      },
    ];
    renderRoute(() => <FeedPostCard post={post} mediaPending />);

    expect(screen.getByText("서명을 기다리지 않는 본문")).toBeInTheDocument();
    expect(screen.getByText("이미지 불러오는 중")).toBeInTheDocument();
    expect(
      screen.queryByText("이미지를 불러오지 못했습니다"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("post-image-grid")).toHaveStyle({
      aspectRatio: 0.75,
    });
    expect(
      screen.getByRole("button", { name: "photo.webp 크게 보기" }),
    ).toBeDisabled();
  });

  it("keeps feed metadata out of the group post title", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(60);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(66);
    renderRoute(() => <FeedPostCard post={staffFeedPost()} />);

    const title = screen.getByRole("heading", { name: "중요 공지" });
    expect(within(title).getByRole("link")).toHaveAttribute(
      "href",
      "/?post=post-id&kind=group&source=notice",
    );
    expect(screen.getByRole("link", { name: "댓글 0개" })).toHaveAttribute(
      "href",
      "/?post=post-id&kind=group&source=notice&view=comments",
    );
    expect(screen.queryByText("고정된 게시물")).not.toBeInTheDocument();
    expect(screen.queryByText("필독")).not.toBeInTheDocument();
    // 피드에도 운영진 표시를 둔다(§8.6). 글자 배지가 아니라 파란 체크라 접근성 이름으로 찾는다.
    expect(
      screen.getByRole("img", { name: "운영진 명의" }),
    ).toBeInTheDocument();
    expect(within(title).queryByText("필독")).not.toBeInTheDocument();
  });
});

describe("FeedPostCard menu", () => {
  it("offers edit and delete on the caller's own post", async () => {
    const post = { ...staffFeedPost(), is_author: true };
    const { user } = renderRoute(() => <FeedPostCard post={post} />);

    await user.click(screen.getByRole("button", { name: "게시물 옵션" }));

    expect(
      await screen.findByRole("menuitem", { name: "수정" }),
    ).toHaveAttribute("href", "/groups/notice/posts/post-id/edit");
    expect(screen.getByRole("menuitem", { name: "삭제" })).toBeInTheDocument();
  });

  // 피드 RPC에는 운영진 권한이 없다. 남의 글의 운영 메뉴는 상세가 맡는다.
  it("shows no menu on someone else's post", () => {
    renderRoute(() => (
      <FeedPostCard post={{ ...staffFeedPost(), is_author: false }} />
    ));

    expect(
      screen.queryByRole("button", { name: "게시물 옵션" }),
    ).not.toBeInTheDocument();
  });
});

describe("FeedPostRow", () => {
  it("shows no hide control on the caller's own profile activity", () => {
    renderRoute(() => (
      <FeedPostRow
        post={{ ...profileActivity(), is_author: true }}
        onHide={vi.fn()}
        isVisited={false}
        onVisit={vi.fn()}
      />
    ));
    expect(
      screen.queryByRole("button", { name: "게시물 옵션" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("dims a visited row and reports the visit", async () => {
    const onVisit = vi.fn();
    const { user } = renderRoute(() => (
      <FeedPostRow post={staffFeedPost()} isVisited onVisit={onVisit} />
    ));

    const link = screen.getByRole("link");
    expect(screen.getByTestId("feed-post-row")).toHaveClass("bg-muted/45");

    await user.click(link);
    expect(onVisit).toHaveBeenCalledOnce();
  });
});
