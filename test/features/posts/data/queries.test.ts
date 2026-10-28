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
  getGroupPost,
  getProfilePost,
  getMyGroupAnonymousActivityRestriction,
  hydrateGroupPostMedia,
  listGroupPinnedPosts,
  listGroupPosts,
  listPostComments,
  listPostPreviews,
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

  it("asks for a post and its attachments at the same time", async () => {
    let resolvePost: (value: unknown) => void = () => undefined;
    const rpc = vi.fn((name: string) =>
      name === "get_group_post"
        ? new Promise((resolve) => {
            resolvePost = resolve;
          })
        : Promise.resolve({ data: [], error: null }),
    );
    getSupabase.mockReturnValue({ rpc });

    const loading = getGroupPost("post-id");
    // 게시물 응답을 기다리지 않고 첨부 목록 요청이 이미 나가 있어야 한다.
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "list_post_attachments",
      "get_group_post",
    ]);
    resolvePost({ data: [{ post_id: "post-id", mentions: [] }], error: null });
    await expect(loading).resolves.toMatchObject({ post_id: "post-id" });
  });

  it("still reports a missing post when its attachments are refused", async () => {
    const rpc = vi.fn((name: string) =>
      Promise.resolve(
        name === "get_group_post"
          ? { data: [], error: null }
          : { data: null, error: { code: "42501" } },
      ),
    );
    getSupabase.mockReturnValue({ rpc });

    await expect(getGroupPost("post-id")).resolves.toBeNull();
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

  it("reads comment images from the list RPC and signs them in one call", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          comment_id: "comment-1",
          post_id: "post-id",
          created_at: "2026-08-24T00:00:00Z",
          images: [],
        },
        {
          comment_id: "comment-2",
          post_id: "post-id",
          created_at: "2026-08-24T00:01:00Z",
          images: [
            {
              image_id: "image-2",
              storage_bucket: "post-attachments",
              object_path: "comments/post-id/image-2",
              mime_type: "image/webp",
              size_bytes: 100,
              width: 100,
              height: 100,
              ready_at: "2026-08-24T00:01:00Z",
            },
          ],
        },
      ],
      error: null,
    });
    createPostAttachmentUrls.mockResolvedValue(
      new Map([["comments/post-id/image-2", "https://signed/image-2"]]),
    );
    getSupabase.mockReturnValue({ rpc });

    const page = await listPostComments("post-id");

    // 이미지를 따로 묻지 않는다 — 그 왕복이 상세를 열 때마다 붙던 것이다.
    expect(rpc).toHaveBeenCalledOnce();
    expect(createPostAttachmentUrls).toHaveBeenCalledOnce();
    expect(page.comments[0].images).toEqual([]);
    expect(page.comments[1].images[0]).toMatchObject({
      image_id: "image-2",
      comment_id: "comment-2",
      post_id: "post-id",
      signedUrl: "https://signed/image-2",
    });
  });

  it("reads timeline attachments from the list RPC without a second query", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: "post-id",
          published_at: "2026-08-13T00:00:00Z",
          attachments: [
            {
              attachment_id: "attachment-1",
              storage_bucket: "post-attachments",
              object_path: "post-id/attachment-1",
              original_filename: "photo.webp",
              position: 0,
              mime_type: "image/webp",
              size_bytes: 100,
              width: 100,
              height: 100,
            },
          ],
        },
      ],
      error: null,
    });
    const from = vi.fn();
    getSupabase.mockReturnValue({ rpc, from });
    createPostAttachmentUrls.mockResolvedValue(
      new Map([["post-id/attachment-1", "https://signed/attachment-1"]]),
    );

    const page = await listProfilePosts("jieun-29");

    expect(from).not.toHaveBeenCalled();
    expect(page.posts[0].attachments[0]).toMatchObject({
      attachment_id: "attachment-1",
      signedUrl: "https://signed/attachment-1",
    });
  });

  it("signs timeline attachments and avatars at the same time", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: "post-id",
          published_at: "2026-08-13T00:00:00Z",
          author_avatar_path: "profiles/avatar.webp",
          attachments: [],
        },
      ],
      error: null,
    });
    getSupabase.mockReturnValue({ rpc, from: vi.fn() });
    let resolveAttachments: (value: Map<string, string>) => void = () =>
      undefined;
    createPostAttachmentUrls.mockReturnValue(
      new Promise((resolve) => {
        resolveAttachments = resolve;
      }),
    );

    const loading = listProfilePosts("jieun-29");
    await vi.waitFor(() => expect(createPostAttachmentUrls).toHaveBeenCalled());
    // 첨부 서명이 끝나기 전에 아바타 서명도 이미 나가 있어야 한다.
    expect(createProfileMediaUrls).toHaveBeenCalled();
    resolveAttachments(new Map());
    await expect(loading).resolves.toMatchObject({ nextCursor: null });
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
    // 첨부는 게시물과 함께 물어본다. 읽을 수 없는 글이면 RLS가 빈 목록을 주고, 결과는 버린다.
    expect(createPostAttachmentUrls).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it("builds the next-page cursor from the last post's publication order", async () => {
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
    });
  });

  it("reads pinned posts from their own RPC and always signs their media", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: "pinned-1",
          is_pinned: true,
          published_at: "2026-08-13T00:00:00Z",
          author_avatar_path: "avatars/a.webp",
          mentions: [],
          attachments: [
            {
              attachment_id: "a1",
              storage_bucket: "post-media",
              object_path: "posts/a1.webp",
              thumbnail_path: "posts/a1-thumb.webp",
              original_filename: "a.webp",
              position: 0,
              mime_type: "image/webp",
              size_bytes: 10,
              width: 10,
              height: 10,
            },
          ],
        },
      ],
      error: null,
    });
    createPostAttachmentUrls.mockResolvedValue(
      new Map([
        ["posts/a1.webp", "https://cdn/a1"],
        ["posts/a1-thumb.webp", "https://cdn/a1-thumb"],
      ]),
    );
    createProfileMediaUrls.mockResolvedValue(
      new Map([["avatars/a.webp", "https://cdn/avatar"]]),
    );
    getSupabase.mockReturnValue({ rpc });

    const posts = await listGroupPinnedPosts("group-id");

    expect(rpc).toHaveBeenCalledWith("list_group_pinned_posts", {
      p_group_id: "group-id",
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].author_avatar_url).toBe("https://cdn/avatar");
    expect(posts[0].attachments[0]).toMatchObject({
      signedUrl: "https://cdn/a1",
      thumbnailUrl: "https://cdn/a1-thumb",
    });
  });

  it("reads group post attachments from the list RPC without a second query", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: "post-1",
          published_at: "2026-08-13T00:00:00Z",
          is_pinned: false,
          author_avatar_path: "avatars/author",
          attachments: [
            {
              attachment_id: "attachment-1",
              storage_bucket: "post-attachments",
              object_path: "post-1/attachment-1",
              thumbnail_path: "post-1/attachment-1-thumb",
              original_filename: "photo.webp",
              position: 0,
              mime_type: "image/webp",
              size_bytes: 100,
              width: 100,
              height: 100,
            },
          ],
        },
      ],
      error: null,
    });
    const from = vi.fn();
    getSupabase.mockReturnValue({ rpc, from });
    createPostAttachmentUrls.mockResolvedValue(
      new Map([["post-1/attachment-1", "https://signed/attachment-1"]]),
    );

    const page = await listGroupPosts("group-id");

    expect(from).not.toHaveBeenCalled();
    expect(createPostAttachmentUrls).toHaveBeenCalledOnce();
    expect(page.posts[0].attachments[0]).toMatchObject({
      attachment_id: "attachment-1",
      post_id: "post-1",
      signedUrl: "https://signed/attachment-1",
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
          attachments: [
            {
              attachment_id: "attachment-1",
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
        },
      ],
      error: null,
    });
    getSupabase.mockReturnValue({ rpc, from: vi.fn() });

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

  it("keeps post card text when photo or avatar signing fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: "p1",
          kind: "group",
          group_name: "밴드부",
          title: "공연 안내",
          body: "토요일 7시",
          author_label: "이한별",
          author_avatar_path: "avatars/4",
          image_path: "p1/a/thumb",
        },
      ],
      error: null,
    });
    getSupabase.mockReturnValue({ rpc });
    createPostAttachmentUrls.mockRejectedValueOnce(new Error("storage 503"));
    createProfileMediaUrls.mockRejectedValueOnce(new Error("storage 503"));

    const previews = await listPostPreviews(["p1", "gone"]);

    expect(previews.get("p1")).toMatchObject({
      title: "공연 안내",
      imageUrl: null,
      authorAvatarUrl: null,
    });
    expect(previews.get("gone")).toBeNull();
  });

  it("signs a profile activity photo from profile media and keeps a staff author's name", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: "activity",
          kind: "profile",
          group_name: null,
          title: null,
          body: "",
          author_identity: "identified",
          author_name: "박새벽",
          author_label: "박새벽",
          author_avatar_path: null,
          image_path: null,
          activity_kind: "cover_changed",
          activity_media_path: "u/cover/c1",
        },
        {
          post_id: "staff",
          kind: "group",
          group_name: "학생회",
          title: "공지",
          body: "본문",
          author_identity: "staff",
          author_name: "이한별",
          author_label: "운영진",
          author_avatar_path: null,
          image_path: null,
          activity_kind: null,
          activity_media_path: null,
        },
      ],
      error: null,
    });
    getSupabase.mockReturnValue({ rpc });
    createProfileMediaUrls.mockResolvedValueOnce(
      new Map([["u/cover/c1", "https://signed/cover"]]),
    );

    const previews = await listPostPreviews(["activity", "staff"]);

    expect(createProfileMediaUrls).toHaveBeenCalledWith(
      expect.arrayContaining(["u/cover/c1"]),
    );
    expect(previews.get("activity")).toMatchObject({
      imageUrl: "https://signed/cover",
      activityKind: "cover_changed",
    });
    expect(previews.get("staff")).toMatchObject({
      authorName: "이한별",
      authorIdentity: "staff",
    });
  });
});
