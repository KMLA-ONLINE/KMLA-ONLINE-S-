import { describe, expect, it } from "vitest";

import {
  sharedPostLink,
  sharedPostOf,
} from "~/features/messaging/model/shared-post";

const ORIGIN = "https://kmla.online";
const POST_ID = "6f1c2a4e-8b3d-4c5e-9a7f-0123456789ab";

describe("sharedPostLink", () => {
  it("본문이 그룹·개인 게시물 상세 링크 하나뿐이면 게시물로 읽는다", () => {
    expect(
      sharedPostLink(`${ORIGIN}/groups/band/posts/${POST_ID}`, ORIGIN),
    ).toEqual({ postId: POST_ID, path: `/groups/band/posts/${POST_ID}` });
    expect(
      sharedPostLink(`${ORIGIN}/profile/ab12cd/posts/${POST_ID}`, ORIGIN),
    ).toEqual({ postId: POST_ID, path: `/profile/ab12cd/posts/${POST_ID}` });
  });

  it("앞뒤 공백과 댓글 시트 같은 query는 허용하고 경로만 남긴다", () => {
    expect(
      sharedPostLink(
        `  ${ORIGIN}/groups/band/posts/${POST_ID}?view=comments \n`,
        ORIGIN,
      ),
    ).toEqual({ postId: POST_ID, path: `/groups/band/posts/${POST_ID}` });
  });

  it("다른 글과 섞인 링크, 다른 origin, 게시물이 아닌 경로는 게시물로 읽지 않는다", () => {
    const link = `${ORIGIN}/groups/band/posts/${POST_ID}`;
    expect(sharedPostLink(`이거 봐 ${link}`, ORIGIN)).toBeNull();
    expect(sharedPostLink(`${link} ${link}`, ORIGIN)).toBeNull();
    expect(
      sharedPostLink(
        `https://evil.example/groups/band/posts/${POST_ID}`,
        ORIGIN,
      ),
    ).toBeNull();
    expect(sharedPostLink(`${link}/edit`, ORIGIN)).toBeNull();
    expect(
      sharedPostLink(`${ORIGIN}/groups/band/posts/new`, ORIGIN),
    ).toBeNull();
    expect(
      sharedPostLink(`${ORIGIN}/feed/posts/${POST_ID}`, ORIGIN),
    ).toBeNull();
    expect(sharedPostLink("", ORIGIN)).toBeNull();
  });
});

describe("sharedPostOf", () => {
  const body = `${ORIGIN}/groups/band/posts/${POST_ID}`;

  it("draws a card only for a live, attachment-free link-only message", () => {
    expect(sharedPostOf({ body }, ORIGIN)?.postId).toBe(POST_ID);
    expect(sharedPostOf({ body, deleted: true }, ORIGIN)).toBeNull();
    expect(sharedPostOf({ body, attachmentKind: "image" }, ORIGIN)).toBeNull();
  });
});
