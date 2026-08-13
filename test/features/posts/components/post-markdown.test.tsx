import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { TwemojiText } from "~/features/posts/components/twemoji-text";

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
});

describe("TwemojiText", () => {
  it.each(["👍🏽", "🇰🇷", "👨‍👩‍👧‍👦"])(
    "renders the complex sequence %s as one self-hosted image",
    (emoji) => {
      const { container } = render(<TwemojiText>{`A${emoji}B`}</TwemojiText>);
      const image = screen.getByRole("img", { name: emoji });
      expect(image).toHaveAttribute(
        "src",
        expect.stringMatching(/^\/twemoji\/15\.0\.0\/.+\.svg$/),
      );
      expect(container).toHaveTextContent("AB");
    },
  );

  it("falls back to the original Unicode when the asset fails", () => {
    render(<TwemojiText>{"Hello 😀"}</TwemojiText>);
    fireEvent.error(screen.getByRole("img", { name: "😀" }));
    expect(screen.getByText("Hello 😀")).toBeInTheDocument();
  });
});
