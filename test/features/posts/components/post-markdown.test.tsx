import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PostMarkdown } from "~/features/posts/components/post-markdown";

describe("PostMarkdown", () => {
  it("renders safe external links without rendering HTML or unsafe links", () => {
    render(
      <PostMarkdown>
        {"[safe](https://example.com) [bad](javascript:alert(1)) <b>html</b>"}
      </PostMarkdown>,
    );

    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.queryByRole("link", { name: "bad" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("html", { selector: "b" }),
    ).not.toBeInTheDocument();
  });

  it("renders underline and keeps other directive-like text literal", () => {
    render(<PostMarkdown>{":u[밑줄 **굵게**] 시간 10:30am"}</PostMarkdown>);

    expect(
      screen.getByText("밑줄", { exact: false, selector: "u" }),
    ).toContainElement(screen.getByText("굵게"));
    expect(screen.getByText(/시간 10:30am/)).toBeInTheDocument();
  });

  it("closes emphasis between punctuation and Korean letters", () => {
    render(<PostMarkdown>{'**끝.**다음 가~~"나"~~다'}</PostMarkdown>);

    expect(screen.getByText("끝.", { selector: "strong" })).toBeVisible();
    expect(screen.getByText('"나"', { selector: "del" })).toBeVisible();
  });

  it("renders emoji as the original Unicode text", () => {
    render(<PostMarkdown>{"이모지 👍🏽 🇰🇷 👨‍👩‍👧‍👦"}</PostMarkdown>);

    expect(screen.getByText("이모지 👍🏽 🇰🇷 👨‍👩‍👧‍👦")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("preserves single and blank lines without doubling every line", () => {
    render(<PostMarkdown>{"\n첫째 줄\n둘째 줄\n"}</PostMarkdown>);

    expect(screen.getByText(/첫째 줄/)).toHaveTextContent(/둘째 줄/);
    expect(screen.getByText(/첫째 줄/)).toHaveClass("whitespace-pre-wrap");
  });

  it("copies one line break per line and keeps blank lines single", () => {
    const { container } = render(
      <PostMarkdown>{`첫째 줄
둘째 줄

## 제목
셋째 **줄**`}</PostMarkdown>,
    );
    /* eslint-disable testing-library/no-node-access --
       The copy handler sits on the wrapper that the selection must stay inside. */
    const body = container.firstElementChild as HTMLElement;
    /* eslint-enable testing-library/no-node-access */
    const range = document.createRange();
    range.selectNodeContents(body);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const setData = vi.fn();

    fireEvent.copy(body, { clipboardData: { setData } });

    expect(setData).toHaveBeenCalledWith(
      "text/plain",
      `첫째 줄
둘째 줄

제목
셋째 줄`,
    );
  });
});
