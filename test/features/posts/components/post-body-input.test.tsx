import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PostBodyInput } from "~/features/posts/components/post-body-input";

const matchMedia = vi.fn();
let breakpointListener: (() => void) | undefined;

vi.mock("~/features/posts/components/desktop-markdown-editor", () => ({
  default: ({ initialValue }: { initialValue: string }) => (
    <div aria-label="데스크톱 본문">{initialValue}</div>
  ),
}));

beforeEach(() => {
  breakpointListener = undefined;
  matchMedia.mockReturnValue({
    matches: false,
    addEventListener: vi.fn((_event, listener) => {
      breakpointListener = listener;
    }),
    removeEventListener: vi.fn(),
  });
  Object.defineProperty(window, "matchMedia", {
    value: matchMedia,
    configurable: true,
  });
});

describe("PostBodyInput", () => {
  it("keeps Markdown source in a native mobile textarea without shortcuts", () => {
    render(<PostBodyInput value="**원문**" />);
    const textarea = screen.getByRole("textbox", { name: "Markdown 본문" });

    expect(textarea).toHaveValue("**원문**");
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "b", ctrlKey: true, isComposing: true });
    fireEvent.compositionEnd(textarea);
    expect(textarea).toHaveValue("**원문**");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("does not request the desktop editor chunk on mobile", async () => {
    render(<PostBodyInput value="body" />);
    await waitFor(() =>
      expect(matchMedia).toHaveBeenCalledWith("(min-width: 768px)"),
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("reports the current mobile draft independently of form snapshots", () => {
    const onValueChange = vi.fn();
    render(<PostBodyInput value="본문" onValueChange={onValueChange} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Markdown 본문" }), {
      target: { value: "수정한 본문" },
    });

    expect(onValueChange).toHaveBeenLastCalledWith("수정한 본문");
  });

  it("keeps the current draft when the breakpoint changes", async () => {
    let desktop = false;
    matchMedia.mockReturnValue({
      get matches() {
        return desktop;
      },
      addEventListener: vi.fn((_event, listener) => {
        breakpointListener = listener;
      }),
      removeEventListener: vi.fn(),
    });
    function ControlledInput() {
      const [value, setValue] = useState("본문");
      return <PostBodyInput value={value} onValueChange={setValue} />;
    }
    render(<ControlledInput />);

    const textarea = screen.getByRole("textbox", { name: "Markdown 본문" });
    fireEvent.change(textarea, { target: { value: "수정한 본문" } });
    expect(textarea).not.toBeRequired();
    desktop = true;
    breakpointListener?.();

    expect(await screen.findByLabelText("데스크톱 본문")).toHaveTextContent(
      "수정한 본문",
    );
  });
});
