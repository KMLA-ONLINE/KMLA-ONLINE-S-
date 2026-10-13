import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { listGroupPosts as listGroupPostsQuery } from "~/features/posts/data/queries";

const { listGroupPosts, hydrateGroupPostMedia } = vi.hoisted(() => ({
  listGroupPosts: vi.fn<typeof listGroupPostsQuery>(),
  hydrateGroupPostMedia: vi.fn(),
}));
vi.mock("~/features/posts/data/queries", () => ({
  listGroupPosts,
  hydrateGroupPostMedia,
}));

import { GroupPostsPanel } from "~/features/posts/components/group/group-posts-panel";
import type { GroupPost } from "~/features/posts/model/types";
import { writePostViewMode } from "~/features/posts/model/view-preference";
import { renderRoute } from "../../../../router";

let observerCallback: IntersectionObserverCallback | null;
const cursor = (postId: string) => ({
  publishedAt: "2026-08-13T00:00:00Z",
  postId,
  isPinned: false,
});
const post = (post_id: string, title: string): GroupPost => ({
  post_id,
  title,
  attachments: [],
  published_at: "2026-08-13T00:00:00Z",
  author_identity: "anonymous",
  author_label: "익명",
  is_author: false,
  is_pinned: false,
  category_name: "",
  category_id: "",
  body: "본문",
  group_id: "group-id",
  author_pub_id: "",
  author_name: "",
  author_avatar_path: null,
  author_avatar_url: null,
  edited_at: "",
  can_edit: false,
  can_delete: false,
  can_pin: false,
  can_moderate_anonymous: false,
  anonymous_author_restricted: false,
  anonymous_author_restriction_expires_at: null,
  mentions: [],
  comment_count: 0,
  reaction_count: 0,
  top_reactions: [],
  my_reaction: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  observerCallback = null;
  writePostViewMode("list");
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe() {
        observerCallback = this.callback;
      }
      disconnect() {
        if (observerCallback === this.callback) observerCallback = null;
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  writePostViewMode("card");
});

function intersect() {
  if (!observerCallback) throw new Error("sentinel is not observed");
  observerCallback(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
}

it("reobserves the sentinel using the committed cursor and renders unique rows", async () => {
  listGroupPosts
    .mockResolvedValueOnce({
      posts: [post("first", "처음"), post("second", "두 번째")],
      nextCursor: cursor("second"),
    })
    .mockResolvedValueOnce({
      posts: [post("second", "두 번째"), post("third", "세 번째")],
      nextCursor: null,
    });
  renderRoute(() => (
    <GroupPostsPanel
      groupId="group-id"
      slug="group"
      categories={[]}
      initialPage={{
        posts: [post("first", "처음")],
        nextCursor: cursor("first"),
      }}
    />
  ));
  act(() => {
    intersect();
    intersect();
  });
  expect(await screen.findByText("두 번째")).toBeVisible();
  await waitFor(() => expect(observerCallback).not.toBeNull());
  act(() => {
    intersect();
    intersect();
  });
  expect(await screen.findByText("세 번째")).toBeVisible();
  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(listGroupPosts).toHaveBeenCalledTimes(2);
  expect(
    listGroupPosts.mock.calls.map(([, options]) => options?.cursor?.postId),
  ).toEqual(["first", "second"]);
  expect(observerCallback).toBeNull();
  expect(hydrateGroupPostMedia).not.toHaveBeenCalled();
});
