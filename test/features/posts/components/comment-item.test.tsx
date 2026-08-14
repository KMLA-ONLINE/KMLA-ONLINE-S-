import { describe, expect, it, vi } from "vitest";

import { CommentItem } from "~/features/posts/components/comment-item";
import { postComment } from "../post-comment-fixture";
import { renderRoute, screen } from "../../../router";

type ItemProps = Parameters<typeof CommentItem>[0];

function renderItem(overrides: Partial<ItemProps> = {}) {
  const props: ItemProps = {
    comment: postComment(),
    indent: 0,
    canReply: true,
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
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

  it("edits in place and reports the normalized body", async () => {
    const onEdit = vi.fn();
    const { user } = renderItem({
      comment: postComment({ can_edit: true, body: "원래 본문" }),
      onEdit,
    });

    await user.click(screen.getByRole("button", { name: "댓글 옵션" }));
    await user.click(await screen.findByRole("menuitem", { name: "수정" }));

    const editor = screen.getByRole("textbox", { name: "댓글 수정" });
    await user.clear(editor);
    await user.type(editor, "  고친 본문  ");
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(onEdit).toHaveBeenCalledWith("고친 본문");
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
      indent: 1,
      onJumpToParent,
    });

    await user.click(screen.getByRole("button", { name: "@익명1" }));
    expect(onJumpToParent).toHaveBeenCalled();
  });

  it("names a deleted parent instead of leaving the reference blank", () => {
    renderItem({
      comment: postComment({
        depth: 2,
        parent_comment_id: "parent-id",
        parent_author_label: null as unknown as string,
        parent_is_deleted: true,
      }),
      indent: 1,
    });

    expect(
      screen.getByRole("button", { name: "@삭제된 댓글" }),
    ).toBeInTheDocument();
  });

  it("drops the reply affordance at the deepest level", () => {
    renderItem({ canReply: false });

    expect(
      screen.queryByRole("button", { name: "답글" }),
    ).not.toBeInTheDocument();
  });
});
