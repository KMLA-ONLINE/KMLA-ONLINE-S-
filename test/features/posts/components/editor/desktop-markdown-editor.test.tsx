import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import DesktopMarkdownEditor from "~/features/posts/components/editor/desktop-markdown-editor";
import type { PostBodyInputHandle } from "~/features/posts/components/editor/post-body-input";

describe("DesktopMarkdownEditor", () => {
  it("loads stored underline as an underline mark and keeps lookalike text", async () => {
    render(<DesktopMarkdownEditor initialValue={":u[밑줄] 시간 10:30am"} />);

    expect(await screen.findByText("밑줄", { selector: "u" })).toBeVisible();
    expect(screen.getByLabelText("본문")).toHaveTextContent(
      "밑줄 시간 10:30am",
    );
    expect(screen.getByRole("button", { name: "밑줄" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+U Meta+U",
    );
  });

  it("serializes underline back to its stored syntax without escaping mentions", async () => {
    const handle = createRef<PostBodyInputHandle>();
    const onValueChange = vi.fn();
    render(
      <DesktopMarkdownEditor
        initialValue={":u[밑줄] 끝"}
        handleRef={handle}
        onValueChange={onValueChange}
      />,
    );
    await screen.findByText("밑줄", { selector: "u" });

    act(() => handle.current?.insertMentions([{ label: "한별", ordinal: 1 }]));

    await waitFor(() =>
      expect(onValueChange).toHaveBeenLastCalledWith(
        expect.stringMatching(/^\[@한별\]\(m:1\) :u\[밑줄\] 끝$/),
      ),
    );
  });

  it.each([
    // 문단 머리 `- ` 뒤에 서식이 오면 Milkdown 기본 처리기가 escape하지 않아 정화가 목록으로 읽고 `-`를 지웠다.
    ["<p>- <strong>굵게</strong></p>", "\\- **굵게**"],
    ['<p>- <a href="m:1">@한별</a></p>', "\\- [@한별](m:1)"],
    // 문장부호로 끝나는 굵게 뒤에 한글이 붙으면 CommonMark에서는 `**`가 닫히지 않아 글자로 남았다.
    ["<p><strong>끝.</strong>다음</p>", "**끝.**다음"],
    ["<p>가<em>(나)</em>다</p>", "가*(나)*다"],
    ["<p>가<del>(나)</del>다</p>", "가~~(나)~~다"],
  ])("serializes %s so it reads back the same", async (html, markdown) => {
    const onValueChange = vi.fn();
    render(
      <DesktopMarkdownEditor initialValue="" onValueChange={onValueChange} />,
    );
    const editor = await screen.findByLabelText("본문");

    fireEvent.paste(editor, {
      clipboardData: {
        types: ["text/html"],
        getData: (type: string) => (type === "text/html" ? html : ""),
      },
    });

    await waitFor(() =>
      expect(onValueChange).toHaveBeenLastCalledWith(markdown),
    );
  });

  it("copies one stored line per line instead of a blank line between each", async () => {
    render(
      <DesktopMarkdownEditor initialValue={"첫 줄\n둘째 줄\n\n넷째 줄"} />,
    );
    const editor = await screen.findByLabelText("본문");
    await waitFor(() => expect(editor).toHaveTextContent("넷째 줄"));
    editor.focus();
    document.getSelection()?.selectAllChildren(editor);
    // ProseMirror는 selectionchange를 다음 작업에서 읽는다.
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const setData = vi.fn();

    fireEvent.copy(editor, { clipboardData: { clearData: vi.fn(), setData } });

    expect(setData).toHaveBeenCalledWith(
      "text/plain",
      "첫 줄\n둘째 줄\n\n넷째 줄",
    );
  });
});
