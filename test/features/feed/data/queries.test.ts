import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createPostAttachmentUrls: vi.fn(),
  createProfileMediaUrls: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ rpc: mocks.rpc }),
}));

vi.mock("~/features/posts/data/files", () => ({
  createPostAttachmentUrls: mocks.createPostAttachmentUrls,
}));

vi.mock("~/features/profiles/data/media", () => ({
  createProfileMediaUrls: mocks.createProfileMediaUrls,
}));

import { listFeedPosts } from "~/features/feed/data/queries";

const common = {
  feed_epoch: "2026-08-24T08:00:00Z",
  next_page_token: "20000000-0000-0000-0000-000000000001",
  feed_position: 1,
  rank_time: "2026-08-24T07:00:00Z",
  post_id: "10000000-0000-0000-0000-000000000001",
  body: "본문",
  author_identity: "identified" as const,
  author_pub_id: "29-test",
  author_name: "테스트",
  author_avatar_path: "avatars/test.webp",
  author_label: "테스트",
  published_at: "2026-08-24T07:00:00Z",
  edited_at: null,
  comment_count: 2,
  reaction_count: 3,
  top_reactions: ["like"] as const,
  my_reaction: null,
  is_author: false,
};

describe("listFeedPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPostAttachmentUrls.mockResolvedValue(
      new Map([["posts/photo.webp", "signed-attachment"]]),
    );
    mocks.createProfileMediaUrls.mockResolvedValue(
      new Map([
        ["avatars/test.webp", "signed-avatar"],
        ["activity/avatar.webp", "signed-activity"],
      ]),
    );
  });

  it("passes the opaque page token and hydrates mixed feed rows in batches", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...common,
          kind: "group",
          title: "그룹 글",
          group_id: "30000000-0000-0000-0000-000000000001",
          group_slug: "notice",
          group_name: "공지",
          category_name: "일반",
          timeline_pub_id: null,
          timeline_name: null,
          activity_kind: null,
          activity_media_path: null,
          visibility: null,
          attachments: [
            {
              attachment_id: "40000000-0000-0000-0000-000000000001",
              storage_bucket: "post-attachments",
              object_path: "posts/photo.webp",
              original_filename: "photo.webp",
              position: 0,
              mime_type: "image/webp",
              size_bytes: 100,
              width: 100,
              height: 100,
              status: "ready",
              created_at: "2026-08-24T07:00:00Z",
              ready_at: "2026-08-24T07:00:01Z",
            },
          ],
        },
        {
          ...common,
          feed_position: 2,
          post_id: "10000000-0000-0000-0000-000000000002",
          kind: "profile",
          title: null,
          group_id: null,
          group_slug: null,
          group_name: null,
          category_name: null,
          timeline_pub_id: "29-timeline",
          timeline_name: "타임라인",
          activity_kind: "avatar_changed",
          activity_media_path: "activity/avatar.webp",
          visibility: "public",
          attachments: [],
        },
      ],
      error: null,
    });

    const page = await listFeedPosts("50000000-0000-0000-0000-000000000001");

    expect(mocks.rpc).toHaveBeenCalledWith("list_feed_posts", {
      p_page_token: "50000000-0000-0000-0000-000000000001",
    });
    expect(mocks.createPostAttachmentUrls).toHaveBeenCalledWith([
      "posts/photo.webp",
    ]);
    expect(mocks.createProfileMediaUrls).toHaveBeenCalledTimes(1);
    expect(page.nextPageToken).toBe(common.next_page_token);
    expect(page.posts).toHaveLength(2);
    expect(page.posts[0]).toMatchObject({
      kind: "group",
      group_slug: "notice",
      author_avatar_path: "signed-avatar",
      attachments: [{ signedUrl: "signed-attachment" }],
    });
    expect(page.posts[1]).toMatchObject({
      kind: "profile",
      timeline_pub_id: "29-timeline",
      activity_media_url: "signed-activity",
    });
  });

  it("returns an empty page without issuing storage requests", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const page = await listFeedPosts();

    expect(page).toEqual({
      posts: [],
      feedEpoch: null,
      nextPageToken: null,
    });
    expect(mocks.createPostAttachmentUrls).toHaveBeenCalledWith([]);
    expect(mocks.createProfileMediaUrls).toHaveBeenCalledWith([]);
  });

  it("propagates RPC failures", async () => {
    const error = new Error("feed failed");
    mocks.rpc.mockResolvedValue({ data: null, error });

    await expect(listFeedPosts()).rejects.toBe(error);
  });
});
