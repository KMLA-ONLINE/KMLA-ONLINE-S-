import { describe, expect, it } from "vitest";

import { CommentText } from "~/features/posts/components/comment/comment-text";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import type { PostMention } from "~/features/posts/model/mentions";

import { renderRoute, screen } from "../../../router";

const 한별: PostMention = {
  ordinal: 1,
  pub_id: "hanbyeol-25",
  name: "이한별",
  avatar_path: null,
};

describe("mentions in a post body", () => {
  it("renders the token as a profile link with the current name", () => {
    // 저장된 토큰의 이름이 아니라 읽기 RPC 가 준 이름을 쓴다. 이름을 바꾸면 옛 글도 함께 바뀐다.
    renderRoute(() => (
      <PostMarkdown mentions={[{ ...한별, name: "이한별(개명)" }]}>
        {"[@이한별](m:1) 님이 맡습니다"}
      </PostMarkdown>
    ));

    const link = screen.getByRole("link", { name: "@이한별(개명)" });
    expect(link).toHaveAttribute("href", "/profile/hanbyeol-25");
    // 멘션은 앱 안쪽 링크다. 외부 링크처럼 새 탭으로 열지 않는다.
    expect(link).not.toHaveAttribute("target");
  });

  it("falls back to plain text when the target is unknown", () => {
    // 개인 게시물처럼 멘션을 쓰지 않는 본문에 손으로 토큰을 친 경우다.
    renderRoute(() => <PostMarkdown>{"[@아무개](m:3) 님"}</PostMarkdown>);

    expect(screen.getByText(/@아무개/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("names a withdrawn target without linking to a profile", () => {
    renderRoute(() => (
      <PostMarkdown
        mentions={[{ ordinal: 1, pub_id: null, name: null, avatar_path: null }]}
      >
        {"[@이한별](m:1) 님"}
      </PostMarkdown>
    ));

    expect(screen.getByText("@탈퇴한 사용자")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps ordinary external links working beside a mention", () => {
    renderRoute(() => (
      <PostMarkdown mentions={[한별]}>
        {"[@이한별](m:1) [문서](https://example.com)"}
      </PostMarkdown>
    ));

    expect(screen.getByRole("link", { name: "문서" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "@이한별" })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25",
    );
  });
});

describe("mentions in a comment body", () => {
  it("renders the token as a profile link", () => {
    renderRoute(() => (
      <CommentText mentions={[한별]}>{"[@이한별](m:1) 님 보세요"}</CommentText>
    ));

    expect(screen.getByRole("link", { name: "@이한별" })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25",
    );
    expect(screen.getByText(/님 보세요/)).toBeInTheDocument();
  });

  it("does not treat the token as Markdown when the target is unknown", () => {
    renderRoute(() => <CommentText>{"[@아무개](m:2)"}</CommentText>);

    expect(screen.getByText("@아무개")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
