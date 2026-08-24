import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedPostCard } from "~/features/feed/components/feed-post";
import type { GroupFeedPost } from "~/features/feed/model/types";
import { groupPost } from "../../posts/group-post-fixture";
import { renderRoute } from "../../../router";

function pinnedFeedPost(): GroupFeedPost {
  return {
    ...groupPost({
      category_name: "필독",
      is_pinned: true,
      title: "중요 공지",
    }),
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

afterEach(() => vi.restoreAllMocks());

describe("FeedPostCard", () => {
  it("uses the established group post positions for pinned and category labels", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(60);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(66);
    renderRoute(() => <FeedPostCard post={pinnedFeedPost()} />);

    const title = screen.getByRole("heading", { name: "중요 공지" });
    expect(within(title).getByRole("link")).toHaveAttribute(
      "href",
      "/?post=post-id&kind=group&source=notice",
    );
    expect(screen.getByRole("link", { name: "댓글 0개" })).toHaveAttribute(
      "href",
      "/?post=post-id&kind=group&source=notice&view=comments",
    );
    expect(screen.getByText("고정된 게시물")).toBeInTheDocument();
    expect(screen.getByText("필독")).toBeInTheDocument();
    expect(within(title).queryByText("필독")).not.toBeInTheDocument();
  });
});
