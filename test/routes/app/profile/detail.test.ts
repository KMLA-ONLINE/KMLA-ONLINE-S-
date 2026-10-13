import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

import { rememberRenamedPubId } from "~/features/profiles";

const { deleteProfilePost, listProfilePosts, loadAcceptedProfile } = vi.hoisted(
  () => ({
    deleteProfilePost: vi.fn(),
    listProfilePosts: vi.fn(),
    loadAcceptedProfile: vi.fn(),
  }),
);

vi.mock("~/features/posts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteProfilePost,
  listProfilePosts,
}));
vi.mock("~/features/profiles", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAcceptedProfile,
}));

import {
  clientAction,
  clientLoader,
  shouldRevalidate,
} from "~/routes/app/profile/detail";

const emptyPage = { posts: [], nextCursor: null };

function loader(pubId: string, path = `/profile/${pubId}`) {
  return clientLoader({
    params: { pubId },
    context: new RouterContextProvider(),
    request: new Request(`https://example.com${path}`),
    url: new URL(`https://example.com${path}`),
    pattern: "/profile/:pubId",
    serverLoader: () => Promise.resolve(undefined),
  });
}

function action(body: URLSearchParams) {
  return clientAction({
    request: new Request("https://example.com/profile/jieun-29", {
      method: "POST",
      body,
    }),
    params: { pubId: "jieun-29" },
    context: new RouterContextProvider(),
    url: new URL("https://example.com/profile/jieun-29"),
    pattern: "/profile/:pubId",
    serverAction: () => Promise.resolve(undefined),
  });
}

describe("profile detail loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAcceptedProfile.mockResolvedValue({ pub_id: "jieun-29", id: 29 });
    listProfilePosts.mockResolvedValue(emptyPage);
  });

  /**
   * 타임라인 RPC가 공개 ID를 받는 이유가 여기 있다. 프로필을 먼저 기다렸다가 그 숫자 ID로
   * 게시물을 부르면 화면 하나에 왕복이 두 번 쌓인다(`AGENTS.md`: loader는 종속 왕복을 만들지
   * 않는다).
   */
  // 공개 ID를 바꾼 뒤 뒤로가기로 옛 주소에 오면 없는 프로필이 아니라 새 주소가 그 자리를 차지한다.
  it("replaces an address this tab renamed with the new one", async () => {
    loadAcceptedProfile.mockResolvedValue(null);
    rememberRenamedPubId("old-29", "jieun-29");

    const rejection = (await loader(
      "old-29",
      "/profile/old-29/posts/p1?image=2",
    ).catch((error: unknown) => error)) as Response;

    expect(rejection.status).toBe(302);
    expect(rejection.headers.get("Location")).toBe(
      "/profile/jieun-29/posts/p1?image=2",
    );
    expect(rejection.headers.get("X-Remix-Replace")).toBe("true");
  });

  it("still shows a missing profile for an address nobody renamed", async () => {
    loadAcceptedProfile.mockResolvedValue(null);

    const rejection = (await loader("nobody").catch(
      (error: unknown) => error,
    )) as Response;

    expect(rejection.status).toBe(404);
  });

  it("asks for the profile and its timeline at the same time", async () => {
    const order: string[] = [];
    loadAcceptedProfile.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            order.push("profile resolved");
            resolve({ pub_id: "jieun-29", id: 29 });
          }, 0),
        ),
    );
    listProfilePosts.mockImplementation(() => {
      order.push("timeline requested");
      return Promise.resolve(emptyPage);
    });

    await loader("jieun-29");

    // 순차였다면 프로필이 끝난 뒤에야 타임라인을 물었을 것이다.
    expect(order).toEqual(["timeline requested", "profile resolved"]);
    expect(listProfilePosts).toHaveBeenCalledWith("jieun-29");
  });

  // 공개 ID는 대소문자를 구분하지 않지만 정식 URL은 하나다(기능 명세 §12.1).
  it("normalizes the public id and redirects to the canonical path", async () => {
    await expect(loader("JiEun-29")).rejects.toMatchObject({ status: 302 });

    expect(loadAcceptedProfile).toHaveBeenCalledWith("jieun-29");
    expect(listProfilePosts).toHaveBeenCalledWith("jieun-29");
  });

  // 상세 dialog 뒤에 깔릴 타임라인을 기다리면 상세가 그만큼 늦게 열린다.
  it("does not hold a direct post detail on the timeline", async () => {
    listProfilePosts.mockReturnValue(new Promise(() => undefined));

    const result = await loader("jieun-29", "/profile/jieun-29/posts/post-id");

    expect(result.profile).toMatchObject({ pub_id: "jieun-29" });
    expect(result.posts).toBeInstanceOf(Promise);
  });

  it("keeps a direct post detail when the background timeline fails", async () => {
    listProfilePosts.mockRejectedValue(new Error("offline"));

    const result = await loader("jieun-29", "/profile/jieun-29/posts/post-id");

    await expect(result.posts).resolves.toBeNull();
  });

  it("404s an unknown profile", async () => {
    loadAcceptedProfile.mockResolvedValue(null);

    await expect(loader("nobody")).rejects.toMatchObject({ status: 404 });
  });
});

describe("profile timeline action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a post from the card menu and lets revalidation refresh", async () => {
    const result = await action(
      new URLSearchParams({ intent: "delete-post", postId: "post-id" }),
    );

    expect(deleteProfilePost).toHaveBeenCalledWith("post-id");
    expect(result).toMatchObject({ data: { ok: true } });
  });

  it("rejects an unknown intent", async () => {
    const result = await action(new URLSearchParams({ intent: "pin-post" }));

    expect(deleteProfilePost).not.toHaveBeenCalled();
    expect(result).toMatchObject({ init: { status: 400 } });
  });

  it("turns a refused deletion into a readable message", async () => {
    deleteProfilePost.mockRejectedValue({
      code: "42501",
      message: "post deletion is not allowed",
    });

    const result = await action(
      new URLSearchParams({ intent: "delete-post", postId: "post-id" }),
    );

    expect(result).toMatchObject({
      data: { error: "이 게시물을 삭제할 권한이 없습니다." },
      init: { status: 400 },
    });
  });
});

describe("profile detail revalidation", () => {
  /**
   * 회귀: 이 route에는 규칙 자체가 없어서, 타임라인 게시물의 이미지를 여는 것만으로 프로필과
   * 타임라인 RPC가 다시 나가고 "더 보기"로 쌓은 페이지가 첫 장으로 되감겼다. 규칙의 내용은
   * `createPostListRevalidation`의 테스트가 확인하므로, 여기서는 규칙이 걸려 있다는 것만 본다.
   */
  it("has a list rule at all", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/profile/jieun-29"),
        nextUrl: new URL(
          "https://example.com/profile/jieun-29?image=attachment-id",
        ),
      } as never),
    ).toBe(false);
  });

  // 회귀: 게시물을 열고 닫을 때마다 프로필과 타임라인을 다시 읽고 쌓은 페이지를 버렸다.
  it("keeps the timeline while a post opens and closes", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/profile/jieun-29"),
        nextUrl: new URL("https://example.com/profile/jieun-29/posts/post-id"),
      } as never),
    ).toBe(false);
    expect(
      shouldRevalidate({
        currentUrl: new URL(
          "https://example.com/profile/jieun-29/posts/post-id",
        ),
        nextUrl: new URL("https://example.com/profile/jieun-29"),
      } as never),
    ).toBe(false);
  });

  it("refreshes the timeline after a post is saved", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/profile/jieun-29/posts/new"),
        nextUrl: new URL("https://example.com/profile/jieun-29/posts/post-id"),
      } as never),
    ).toBe(true);
  });
});
