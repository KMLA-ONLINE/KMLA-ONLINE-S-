import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

  it("renders emoji as the original Unicode text", () => {
    render(<PostMarkdown>{"이모지 👍🏽 🇰🇷 👨‍👩‍👧‍👦"}</PostMarkdown>);

    expect(screen.getByText("이모지 👍🏽 🇰🇷 👨‍👩‍👧‍👦")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
