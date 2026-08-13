import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PostBodyInput } from "~/features/posts/components/post-body-input";

const matchMedia = vi.fn();

beforeEach(() => {
  matchMedia.mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  Object.defineProperty(window, "matchMedia", {
    value: matchMedia,
    configurable: true,
  });
});

describe("PostBodyInput", () => {
  it("keeps Markdown source in a native mobile textarea without shortcuts", () => {
    render(<PostBodyInput initialValue="**원문**" />);
    const textarea = screen.getByRole("textbox", { name: "Markdown 본문" });

    expect(textarea).toHaveValue("**원문**");
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "b", ctrlKey: true, isComposing: true });
    fireEvent.compositionEnd(textarea);
    expect(textarea).toHaveValue("**원문**");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("does not request the desktop editor chunk on mobile", async () => {
    render(<PostBodyInput initialValue="body" />);
    await waitFor(() =>
      expect(matchMedia).toHaveBeenCalledWith("(min-width: 768px)"),
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
