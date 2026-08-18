import { describe, expect, it } from "vitest";

import { getPostErrorMessage } from "~/features/posts/model/format";
import {
  readPostForm,
  readProfilePostForm,
  validatePostForm,
  validateProfilePostForm,
} from "~/features/posts/model/validation";

describe("post form validation", () => {
  it("requires a title and either a body or attachment", () => {
    expect(
      validatePostForm({
        title: "",
        body: "",
        categoryId: "",
        authorIdentity: "identified",
      }),
    ).toEqual({
      title: "제목을 입력해 주세요.",
      body: "본문 또는 첨부 파일을 추가해 주세요.",
    });
    expect(
      validatePostForm(
        {
          title: "첨부 게시물",
          body: "",
          categoryId: "",
          authorIdentity: "identified",
        },
        1,
      ),
    ).toEqual({});
  });

  it("validates identity and category against route-loaded choices", () => {
    expect(
      validatePostForm(
        {
          title: "제목",
          body: "본문",
          categoryId: "other",
          authorIdentity: "anonymous",
        },
        0,
        ["identified"],
        ["category"],
      ),
    ).toEqual({
      authorIdentity: "선택할 수 없는 작성 신원입니다.",
      categoryId: "선택할 수 없는 카테고리입니다.",
    });
  });

  it("normalizes form text and rejects unknown identity values", () => {
    const formData = new FormData();
    formData.set("title", "  제목  ");
    formData.set("body", "\r\n첫째 줄\r\n둘째 줄\r\n");
    formData.set("authorIdentity", "invalid");

    expect(readPostForm(formData)).toMatchObject({
      title: "제목",
      body: "첫째 줄\n둘째 줄",
      authorIdentity: "identified",
    });
  });
});

describe("validateProfilePostForm", () => {
  it("accepts a body-only post, since profile posts have no title", () => {
    expect(
      validateProfilePostForm({ body: "메모", visibility: "public" }),
    ).toEqual({});
  });

  it("accepts an attachment-only post", () => {
    expect(
      validateProfilePostForm({ body: "", visibility: "public" }, 1),
    ).toEqual({});
  });

  it("rejects a post with neither body nor attachment", () => {
    expect(validateProfilePostForm({ body: "", visibility: "public" })).toEqual(
      { body: "본문 또는 첨부 파일을 추가해 주세요." },
    );
  });

  // 타인 타임라인 글은 언제나 전체 공개다(기능 명세 §8.4). 서버도 같은 이유로 되돌린다.
  it("rejects a private post on someone else timeline", () => {
    expect(
      validateProfilePostForm(
        { body: "메모", visibility: "private" },
        0,
        false,
      ),
    ).toMatchObject({
      visibility:
        "다른 사용자의 타임라인에 쓴 게시물은 전체 공개로만 남길 수 있습니다.",
    });
  });

  it("falls back to public for an unknown visibility value", () => {
    const formData = new FormData();
    formData.set("body", "\r\n첫째 줄\r\n둘째 줄\r\n");
    formData.set("visibility", "invalid");

    expect(readProfilePostForm(formData)).toEqual({
      body: "첫째 줄\n둘째 줄",
      visibility: "public",
    });
  });
});

describe("getPostErrorMessage", () => {
  it("turns common database failures into useful Korean messages", () => {
    expect(getPostErrorMessage({ code: "42501" })).toBe(
      "이 작업을 수행할 권한이 없습니다.",
    );
    expect(getPostErrorMessage({ code: "23505" })).toBe(
      "같은 이름의 카테고리가 이미 있습니다.",
    );
  });

  // 개인 게시물 거절은 42501로 뭉뚱그리면 "권한이 없습니다"가 되어 무엇을 고쳐야 할지
  // 알 수 없다. 서버 문구를 보고 갈라 준다.
  it("explains why a closed timeline refused the post", () => {
    expect(
      getPostErrorMessage({
        code: "42501",
        message: "timeline owner does not accept posts",
      }),
    ).toBe("이 사용자는 타임라인에 다른 사람의 글을 받지 않습니다.");
  });
});
