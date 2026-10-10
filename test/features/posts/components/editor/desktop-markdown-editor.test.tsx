import { act, render, screen, waitFor } from "@testing-library/react";
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
});
