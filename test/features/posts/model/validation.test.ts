import { describe, expect, it } from "vitest";

import { getPostErrorMessage } from "~/features/posts/model/format";
import {
  readPostForm,
  validatePostForm,
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

describe("getPostErrorMessage", () => {
  it("turns common database failures into useful Korean messages", () => {
    expect(getPostErrorMessage({ code: "42501" })).toBe(
      "이 작업을 수행할 권한이 없습니다.",
    );
    expect(getPostErrorMessage({ code: "23505" })).toBe(
      "같은 이름의 카테고리가 이미 있습니다.",
    );
  });
});
