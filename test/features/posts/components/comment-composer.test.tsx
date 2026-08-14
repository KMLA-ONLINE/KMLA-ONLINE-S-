import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommentComposer } from "~/features/posts/components/comment-composer";
import { COMMENT_MAX_LENGTH } from "~/features/posts/model/comment-text";
import type { PostIdentity } from "~/features/posts/model/types";
import { renderRoute } from "../../../router";

type ComposerProps = Parameters<typeof CommentComposer>[0];

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const onSubmit = vi.fn();
  const onIdentityChange = vi.fn();
  const identities: PostIdentity[] = ["identified", "anonymous"];
  const props: ComposerProps = {
    viewer: { name: "홍길동", avatarUrl: null },
    identities,
    identity: "identified",
    onIdentityChange,
    onSubmit,
    ...overrides,
  };
  const view = renderRoute(() => <CommentComposer {...props} />);
  return {
    ...view,
    onSubmit,
    onIdentityChange,
    input: screen.getByRole("textbox", { name: "댓글 입력" }),
  };
}

describe("CommentComposer", () => {
  it("submits on Enter and inserts a newline on Shift+Enter", async () => {
    const { user, onSubmit, input } = renderComposer();

    await user.type(input, "첫 줄{Shift>}{Enter}{/Shift}둘째 줄");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(input, "{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("첫 줄\n둘째 줄");
  });

  it("ignores Enter while an IME composition is still open", async () => {
    const { user, onSubmit, input } = renderComposer();

    await user.type(input, "안녕하세");

    // 조합 중의 `Enter`는 글자를 확정하는 키다. 이걸 등록으로 처리하면 "안녕하세"까지만 쓴
    // 댓글이 올라간다.
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("안녕하세");
  });

  it("keeps the send button unavailable while the draft is blank", async () => {
    const { user, onSubmit, input } = renderComposer();

    expect(screen.getByRole("button", { name: "댓글 게시" })).toBeDisabled();

    await user.type(input, "   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "댓글 내용을 입력해 주세요.",
    );
  });

  it("blocks submission once the body passes the length limit", async () => {
    const { onSubmit, input } = renderComposer();

    // 5,000자를 한 글자씩 입력하면 느리므로 값만 직접 넣는다.
    const typist = userEvent.setup({ delay: null });
    await typist.click(input);
    await typist.paste("가".repeat(COMMENT_MAX_LENGTH + 1));

    expect(screen.getByRole("button", { name: "댓글 게시" })).toBeDisabled();
    expect(screen.getByText("5,001 / 5,000")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("confirms before switching the writing identity", async () => {
    const { user, onIdentityChange } = renderComposer();

    await user.click(screen.getByRole("button", { name: /실명으로 작성 중/ }));
    expect(onIdentityChange).not.toHaveBeenCalled();
    expect(await screen.findByText("익명으로 작성할까요?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "바꾸기" }));
    expect(onIdentityChange).toHaveBeenCalledWith("anonymous");
  });

  it("keeps the identity unchanged when the confirmation is dismissed", async () => {
    const { user, onIdentityChange } = renderComposer();

    await user.click(screen.getByRole("button", { name: /실명으로 작성 중/ }));
    await user.click(await screen.findByRole("button", { name: "취소" }));

    expect(onIdentityChange).not.toHaveBeenCalled();
  });

  it("cycles through every identity the group allows", async () => {
    const { user, onIdentityChange } = renderComposer({
      identities: ["identified", "anonymous", "staff"],
      identity: "anonymous",
    });

    await user.click(screen.getByRole("button", { name: /익명으로 작성 중/ }));
    await user.click(await screen.findByRole("button", { name: "바꾸기" }));
    expect(onIdentityChange).toHaveBeenCalledWith("staff");
  });

  it("hides the identity toggle when only one identity is allowed", () => {
    renderComposer({ identities: ["anonymous"], identity: "anonymous" });

    expect(
      screen.queryByRole("button", { name: /작성 중/ }),
    ).not.toBeInTheDocument();
  });

  it("names the comment being replied to through its placeholder", () => {
    renderComposer({ placeholder: "익명2님에게 답글 남기기…" });

    expect(
      screen.getByPlaceholderText("익명2님에게 답글 남기기…"),
    ).toBeInTheDocument();
  });
});
