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

  it("shows the remaining scheduled restriction in the cancellation flow", async () => {
    const { user } = renderItem({
      comment: postComment({
        author_identity: "anonymous",
        author_label: "익명2",
        author_name: null as unknown as string,
        author_pub_id: null as unknown as string,
        can_moderate_anonymous: true,
        anonymous_author_restricted: true,
        anonymous_author_restriction_expires_at: new Date(
          Date.now() + 3 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
    });

    await user.click(screen.getByRole("button", { name: "댓글 옵션" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "익명 차단 해제" }),
    );
    await user.click(screen.getByRole("button", { name: "차단 해제" }));

    expect(
      screen.getByText("앞으로 3일 동안 익명 활동이 차단될 예정이었습니다."),
    ).toBeInTheDocument();
  });

  it("colors an effective #업 comment blue", () => {
    renderItem({
      comment: postComment({
        body: "#업",
        is_effective_feed_bump: true,
      }),
    });

    expect(screen.getByText("#업")).toHaveClass("text-primary");
  });

  it("does not color an ineffective #업 comment", () => {
    renderItem({ comment: postComment({ body: "#업" }) });

    expect(screen.getByText("#업")).not.toHaveClass("text-primary");
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

  it("badges the comment the post author wrote", () => {
    renderItem({ isPostAuthor: true });

    expect(screen.getByText("작성자")).toHaveClass("text-primary");
  });

  it("leaves everyone else's comment unbadged", () => {
    renderItem();

    expect(screen.queryByText("작성자")).not.toBeInTheDocument();
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

  it("renders and downloads a comment image under its image UUID", async () => {
    const { user } = renderItem({
      comment: postComment({
        images: [
          {
            image_id: "image-id",
            comment_id: "comment-id",
            post_id: "post-id",
            storage_bucket: "post-attachments",
            object_path: "comments/post-id/image-id",
            mime_type: "image/webp",
            size_bytes: 10,
            width: 100,
            height: 80,
            ready_at: "2026-08-24T00:00:01Z",
            signedUrl: "https://signed/image.webp",
          },
        ],
      }),
    });

    expect(screen.getByRole("img", { name: "댓글 이미지" })).toHaveAttribute(
      "src",
      "https://signed/image.webp",
    );

    await user.click(
      screen.getByRole("button", { name: "댓글 이미지 크게 보기" }),
    );

    const download = screen.getByRole("link", { name: "다운로드" });
    expect(download).toHaveAttribute(
      "href",
      "https://signed/image.webp?download=image-id.webp",
    );
    expect(download).toHaveAttribute("download", "image-id.webp");
  });

  it("does not render an image on a deleted tombstone", () => {
    renderItem({
      comment: postComment({
        is_deleted: true,
        images: [
          {
            image_id: "image-id",
            comment_id: "comment-id",
            post_id: "post-id",
            storage_bucket: "post-attachments",
            object_path: "comments/post-id/image-id",
            mime_type: "image/webp",
            size_bytes: 10,
            width: 100,
            height: 80,
            ready_at: "2026-08-24T00:00:01Z",
            signedUrl: "https://signed/image.webp",
          },
        ],
      }),
    });

    expect(
      screen.queryByRole("img", { name: "댓글 이미지" }),
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

  it("can remove an existing image while editing", async () => {
    const onEdit = vi.fn();
    const { user } = renderItem({
      comment: postComment({
        can_edit: true,
        body: "사진 댓글",
        images: [
          {
            image_id: "image-id",
            comment_id: "comment-id",
            post_id: "post-id",
            storage_bucket: "post-attachments",
            object_path: "comments/post-id/image-id",
            mime_type: "image/webp",
            size_bytes: 10,
            width: 100,
            height: 80,
            ready_at: "2026-08-24T00:00:01Z",
            signedUrl: "https://signed/image.webp",
          },
        ],
      }),
      onEdit,
    });

    await user.click(screen.getByRole("button", { name: "댓글 옵션" }));
    await user.click(await screen.findByRole("menuitem", { name: "수정" }));
    await user.click(screen.getByRole("button", { name: "댓글 이미지 제거" }));
    await user.click(screen.getByRole("button", { name: "댓글 수정" }));

    expect(onEdit).toHaveBeenCalledWith("사진 댓글", null);
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
