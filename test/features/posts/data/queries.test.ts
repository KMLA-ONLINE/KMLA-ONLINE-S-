import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPostAttachmentUrls, createProfileMediaUrls, getSupabase } =
  vi.hoisted(() => ({
    createPostAttachmentUrls: vi.fn().mockResolvedValue(new Map()),
    createProfileMediaUrls: vi.fn().mockResolvedValue(new Map()),
    getSupabase: vi.fn(),
  }));

vi.mock("~/features/posts/data/files", () => ({ createPostAttachmentUrls }));
vi.mock("~/features/profiles/data/media", () => ({ createProfileMediaUrls }));
vi.mock("~/shared/supabase/client", () => ({ getSupabase }));

import {
  getProfilePost,
  getMyGroupAnonymousActivityRestriction,
  hydrateGroupPostMedia,
  listGroupPosts,
  listPostComments,
  listPostReactors,
  listProfilePosts,
  searchGroupPosts,
} from "~/features/posts/data/queries";

describe("post queries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads only the caller's active anonymous activity restriction", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ reason: "운영 방해", expires_at: "2026-09-01T00:00:00Z" }],
      error: null,
    });
    getSupabase.mockReturnValue({ rpc });

    await expect(
      getMyGroupAnonymousActivityRestriction("group-id"),
    ).resolves.toEqual({
      reason: "운영 방해",
      expires_at: "2026-09-01T00:00:00Z",
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_my_group_anonymous_activity_restriction",
      { p_group_id: "group-id" },
    );
  });

  it("does not load or sign attachments for search results", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ post_id: "post-id", title: "결과" }],
      error: null,
    });
    const from = vi.fn();
    getSupabase.mockReturnValue({ rpc, from });

    await expect(searchGroupPosts("group-id", "검색")).resolves.toEqual([
      { post_id: "post-id", title: "결과" },
    ]);
    expect(from).not.toHaveBeenCalled();
    expect(createPostAttachmentUrls).not.toHaveBeenCalled();
  });

  it("hydrates a comment page with one batched image lookup and signing call", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            comment_id: "comment-1",
            post_id: "post-id",
            created_at: "2026-08-24T00:00:00Z",
          },
          {
            comment_id: "comment-2",
            post_id: "post-id",
            created_at: "2026-08-24T00:01:00Z",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            image_id: "image-2",
            comment_id: "comment-2",
            object_path: "comments/post-id/image-2",
          },
        ],
        error: null,
      });
    createPostAttachmentUrls.mockResolvedValue(
      new Map([["comments/post-id/image-2", "https://signed/image-2"]]),
    );
    getSupabase.mockReturnValue({ rpc });

    const page = await listPostComments("post-id");

    expect(rpc).toHaveBeenNthCalledWith(2, "list_comment_images", {
      p_comment_ids: ["comment-1", "comment-2"],
    });
    expect(createPostAttachmentUrls).toHaveBeenCalledOnce();
    expect(page.comments[0].images).toEqual([]);
    expect(page.comments[1].images[0]).toMatchObject({
      image_id: "image-2",
      signedUrl: "https://signed/image-2",
    });
  });

  it("propagates attachment metadata query failures", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: "post-id",
          published_at: "2026-08-13T00:00:00Z",
        },
      ],
      error: null,
    });
    const attachmentError = new Error("attachment metadata failed");
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({ data: null, error: attachmentError }),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    getSupabase.mockReturnValue({
      rpc,
      from: vi.fn().mockReturnValue(query),
    });

    await expect(listGroupPosts("group-id")).rejects.toBe(attachmentError);
    expect(createPostAttachmentUrls).not.toHaveBeenCalled();
  });

  it("asks for the timeline by public id so the loader need not resolve it first", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    getSupabase.mockReturnValue({ rpc, from: vi.fn() });

    await listProfilePosts("jieun-29");

    expect(rpc).toHaveBeenCalledWith(
      "list_profile_posts",
      expect.objectContaining({ p_timeline_pub_id: "jieun-29" }),
    );
  });

  it("carries only time and id in the timeline cursor", async () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({
      post_id: `post-${index}`,
      published_at: `2026-08-18T00:00:${String(59 - index).padStart(2, "0")}Z`,
    }));
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    getSupabase.mockReturnValue({ rpc, from: vi.fn().mockReturnValue(query) });

    const page = await listProfilePosts("jieun-29");

    expect(page.posts).toHaveLength(12);
    expect(page.nextCursor).toEqual({
      publishedAt: rows[11].published_at,
      postId: "post-11",
    });
  });

  it("stops at the last page of a timeline", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ post_id: "post-id", published_at: "2026-08-18T00:00:00Z" }],
      error: null,
    });
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    getSupabase.mockReturnValue({ rpc, from: vi.fn().mockReturnValue(query) });

    await expect(listProfilePosts("jieun-29")).resolves.toMatchObject({
      nextCursor: null,
    });
  });

  it("treats a missing or unreadable profile post as absent", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    getSupabase.mockReturnValue({ rpc, from: vi.fn() });

    await expect(getProfilePost("post-id")).resolves.toBeNull();
    // 첨부를 이어 부르지 않는다 — 읽을 수 없는 게시물의 첨부를 물어볼 이유가 없다.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("uses pinned state as part of the next-page cursor", async () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({
      post_id: `post-${index}`,
      published_at: `2026-08-13T00:00:${String(59 - index).padStart(2, "0")}Z`,
      is_pinned: index < 12,
    }));
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    getSupabase.mockReturnValue({ rpc, from: vi.fn().mockReturnValue(query) });

    const page = await listGroupPosts("group-id");
    expect(page.nextCursor).toEqual({
      publishedAt: rows[11].published_at,
      postId: "post-11",
      isPinned: true,
    });
  });

  it("does not sign group post media for list-mode reads", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: "post-1",
          published_at: "2026-08-13T00:00:00Z",
          is_pinned: false,
          author_avatar_path: "avatars/author",
        },
      ],
      error: null,
    });
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: "attachment-1",
            post_id: "post-1",
            storage_bucket: "post-attachments",
            object_path: "post-1/attachment-1",
            original_filename: "photo.webp",
            position: 0,
            mime_type: "image/webp",
            size_bytes: 100,
            width: 100,
            height: 100,
          },
        ],
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    getSupabase.mockReturnValue({ rpc, from: vi.fn().mockReturnValue(query) });

    const page = await listGroupPosts("group-id", { hydrateMedia: false });

    expect(createPostAttachmentUrls).not.toHaveBeenCalled();
    expect(createProfileMediaUrls).not.toHaveBeenCalled();
    expect(page.posts[0].attachments[0].signedUrl).toBeNull();
  });
  /**
   * 서명은 실패할 수 있다(만료된 세션, 지워진 객체, 배치 중 일부 거절). 그때 표시용 URL에
   * 원시 object path가 남으면 `<img src>`가 상대 경로로 나가 깨진 이미지가 된다.
   */
  it("leaves the avatar URL null when Storage did not sign the path", async () => {
    createPostAttachmentUrls.mockResolvedValue(new Map());
    createProfileMediaUrls.mockResolvedValue(new Map());

    const [post] = await hydrateGroupPostMedia([
      {
        post_id: "post-id",
        author_avatar_path: "profiles/avatar.webp",
        attachments: [],
      },
    ] as never);

    expect(post?.author_avatar_url).toBeNull();
  });

  it("keeps the signed avatar URL when signing succeeds", async () => {
    createPostAttachmentUrls.mockResolvedValue(new Map());
    createProfileMediaUrls.mockResolvedValue(
      new Map([["profiles/avatar.webp", "https://signed.example/avatar"]]),
    );

    const [post] = await hydrateGroupPostMedia([
      {
        post_id: "post-id",
        author_avatar_path: "profiles/avatar.webp",
        attachments: [],
      },
    ] as never);

    expect(post?.author_avatar_url).toBe("https://signed.example/avatar");
  });

  /**
   * 로더가 채워 둔 첫 페이지를 화면의 효과가 한 번 더 통과시킨다
   * (`group-posts-panel.tsx`, `feed-screen.tsx`). 서명 결과를 경로 컬럼에 덮어쓰면 두 번째
   * 통과에서 signed URL이 object path 자리로 들어가 서명이 실패하고, 그룹 홈과 피드의
   * 아바타가 통째로 기본 실루엣이 된다.
   */
  it("keeps the avatar across a second hydration pass", async () => {
    createPostAttachmentUrls.mockResolvedValue(new Map());
    // Storage처럼 굴게 한다 — 실제로 존재하는 object 경로만 서명된다.
    createProfileMediaUrls.mockImplementation((paths: (string | null)[]) =>
      Promise.resolve(
        new Map(
          paths
            .filter((path) => path === "profiles/avatar.webp")
            .map((path) => [path, "https://signed.example/avatar"] as const),
        ),
      ),
    );

    const [once] = await hydrateGroupPostMedia([
      {
        post_id: "post-id",
        author_avatar_path: "profiles/avatar.webp",
        attachments: [],
      },
    ] as never);
    const [twice] = await hydrateGroupPostMedia([once]);

    expect(twice?.author_avatar_url).toBe("https://signed.example/avatar");
  });

  it("signs comment author avatars", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            comment_id: "comment-1",
            post_id: "post-id",
            author_avatar_path: "profiles/avatar.webp",
            created_at: "2026-08-24T00:00:00Z",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });
    getSupabase.mockReturnValue({ rpc });
    createPostAttachmentUrls.mockResolvedValue(new Map());
    createProfileMediaUrls.mockResolvedValue(
      new Map([["profiles/avatar.webp", "https://signed.example/avatar"]]),
    );

    const page = await listPostComments("post-id");

    expect(createProfileMediaUrls).toHaveBeenCalledWith([
      "profiles/avatar.webp",
    ]);
    expect(page.comments[0]?.author_avatar_url).toBe(
      "https://signed.example/avatar",
    );
  });

  it("signs reactor avatars", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          reaction: "like",
          reactor_pub_id: "hanbyeol-25",
          reactor_name: "이한별",
          reactor_avatar_path: "profiles/avatar.webp",
          reacted_at: "2026-08-24T00:00:00Z",
        },
      ],
      error: null,
    });
    getSupabase.mockReturnValue({ rpc });
    createProfileMediaUrls.mockResolvedValue(
      new Map([["profiles/avatar.webp", "https://signed.example/avatar"]]),
    );

    const [reactor] = await listPostReactors("post-id");

    expect(reactor?.reactor_avatar_url).toBe("https://signed.example/avatar");
  });
});
