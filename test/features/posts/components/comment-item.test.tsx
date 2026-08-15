import { describe, expect, it, vi } from "vitest";

import { CommentItem } from "~/features/posts/components/comment-item";
import { postComment } from "../post-comment-fixture";
import { renderRoute, screen } from "../../../router";

type ItemProps = Parameters<typeof CommentItem>[0];

function renderItem(overrides: Partial<ItemProps> = {}) {
  const props: ItemProps = {
    comment: postComment(),
    viewer: { name: "홍길동", avatarUrl: null },
    canReply: true,
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onReact: vi.fn(),
    ...overrides,
  };
  return {
    ...renderRoute(() => <CommentItem {...props} />),
    props,
  };
}

describe("CommentItem", () => {
  it("links an identified author to their profile", () => {
    renderItem();

    expect(screen.getByRole("link", { name: "이한별" })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25",
    );
  });

  it("shows the anonymous label without a profile link", () => {
    renderItem({
      comment: postComment({
        author_identity: "anonymous",
        author_label: "익명2",
        author_name: null as unknown as string,
        author_pub_id: null as unknown as string,
      }),
    });

    expect(screen.getByText("익명2")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("badges a staff byline while still showing the real author", () => {
    renderItem({
      comment: postComment({
        author_identity: "staff",
        author_label: "운영진",
        author_name: "김관리",
        author_pub_id: "kim-admin",
      }),
    });

    expect(screen.getByRole("link", { name: "김관리" })).toBeInTheDocument();
    expect(screen.getByText("운영진")).toBeInTheDocument();
  });

  it("renders a tombstone without author or body", () => {
    renderItem({
      comment: postComment({
        is_deleted: true,
        body: "",
        author_label: null as unknown as string,
        depth: 1,
      }),
    });

    expect(screen.getByText("삭제된 댓글입니다")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "댓글 옵션" }),
    ).not.toBeInTheDocument();
  });

  it("hides the option menu when the viewer may neither edit nor delete", () => {
    renderItem();

    expect(
      screen.queryByRole("button", { name: "댓글 옵션" }),
    ).not.toBeInTheDocument();
  });

  it("edits through the same composer the replies use", async () => {
    const onEdit = vi.fn();
    const { user } = renderItem({
      comment: postComment({ can_edit: true, body: "원래 본문" }),
      onEdit,
    });

    await user.click(screen.getByRole("button", { name: "댓글 옵션" }));
    await user.click(await screen.findByRole("menuitem", { name: "수정" }));

    // 입력창은 원래 본문에서 시작하고, 신원은 바꿀 수 없으므로 토글이 없다.
    const editor = screen.getByRole("textbox", { name: "댓글 입력" });
    expect(editor).toHaveValue("원래 본문");
    expect(
      screen.queryByRole("button", { name: /작성 중/ }),
    ).not.toBeInTheDocument();

    await user.clear(editor);
    await user.type(editor, "  고친 본문  ");
    await user.click(screen.getByRole("button", { name: "댓글 수정" }));

    expect(onEdit).toHaveBeenCalledWith("고친 본문");
  });

  it("leaves the comment untouched when the edit is reverted", async () => {
    const onEdit = vi.fn();
    const { user } = renderItem({
      comment: postComment({ can_edit: true, body: "원래 본문" }),
      onEdit,
    });

    await user.click(screen.getByRole("button", { name: "댓글 옵션" }));
    await user.click(await screen.findByRole("menuitem", { name: "수정" }));
    await user.click(screen.getByRole("button", { name: "되돌리기" }));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText("원래 본문")).toBeInTheDocument();
  });

  it("confirms before deleting and warns when replies go with it", async () => {
    const onDelete = vi.fn();
    const { user } = renderItem({
      comment: postComment({ can_delete: true, reply_count: 3 }),
      onDelete,
    });

    await user.click(screen.getByRole("button", { name: "댓글 옵션" }));
    await user.click(await screen.findByRole("menuitem", { name: "삭제" }));

    expect(
      await screen.findByText("이 댓글에 달린 답글도 함께 사라집니다."),
    ).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "삭제" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("points a deep reply back at its parent", async () => {
    const onJumpToParent = vi.fn();
    const { user } = renderItem({
      comment: postComment({
        depth: 3,
        parent_comment_id: "parent-id",
        parent_author_label: "익명1",
      }),
      onJumpToParent,
    });

    await user.click(screen.getByRole("button", { name: "@익명1" }));
    expect(onJumpToParent).toHaveBeenCalled();
  });

  it("reports the reaction the viewer picks", async () => {
    const onReact = vi.fn();
    const { user } = renderItem({ onReact });

    await user.click(screen.getByRole("button", { name: "반응 남기기" }));
    await user.click(screen.getByRole("button", { name: "하트 반응 남기기" }));

    expect(onReact).toHaveBeenCalledWith("love");
  });

  it("keeps a tombstone free of reactions", () => {
    renderItem({ comment: postComment({ is_deleted: true, body: "" }) });

    expect(
      screen.queryByRole("button", { name: "반응 남기기" }),
    ).not.toBeInTheDocument();
  });
});
