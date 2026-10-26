import { afterEach, describe, expect, it } from "vitest";

import { GroupPostFeedEmpty } from "~/features/posts/components/group/group-post-feed";
import { renderRoute, screen } from "../../../../router";

describe("GroupPostFeedEmpty", () => {
  afterEach(() => window.localStorage.clear());

  it("invites the first post in Korean by default", () => {
    renderRoute(() => <GroupPostFeedEmpty searched={false} />);

    expect(screen.getByText("아직 게시물이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("가장 먼저 글을 남겨보세요.")).toBeInTheDocument();
  });

  it("renders both empty states in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    const { unmount } = renderRoute(() => (
      <GroupPostFeedEmpty searched={false} />
    ));

    expect(screen.getByText("No posts yet")).toBeInTheDocument();
    expect(screen.getByText("Be the first to post.")).toBeInTheDocument();
    unmount();

    renderRoute(() => <GroupPostFeedEmpty searched />);

    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByText("Try a different search.")).toBeInTheDocument();
  });
});
