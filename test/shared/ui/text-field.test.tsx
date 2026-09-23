import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TextField } from "~/shared/ui/text-field";

describe("TextField", () => {
  it("uses one-row, non-multiline semantics", () => {
    render(<TextField aria-label="한 줄 입력" />);

    const textarea = screen.getByRole("textbox", { name: "한 줄 입력" });
    expect(textarea).toHaveAttribute("rows", "1");
    expect(textarea).toHaveAttribute("aria-multiline", "false");
    expect(textarea).toHaveAttribute("wrap", "off");
    expect(textarea).toHaveAttribute("enterkeyhint", "next");
  });

  it("prevents Enter from creating a new line", () => {
    render(<TextField aria-label="한 줄 입력" />);

    const textarea = screen.getByRole("textbox", { name: "한 줄 입력" });
    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(false);
  });

  it("moves focus to the next control on Enter", () => {
    render(
      <>
        <TextField aria-label="한 줄 입력" />
        <input aria-label="다음 입력" />
      </>,
    );

    const textarea = screen.getByRole("textbox", { name: "한 줄 입력" });
    const nextInput = screen.getByRole("textbox", { name: "다음 입력" });
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(nextInput).toHaveFocus();
  });

  it("removes line breaks from changed values", () => {
    render(<TextField aria-label="한 줄 입력" />);

    const textarea = screen.getByRole("textbox", { name: "한 줄 입력" });
    fireEvent.change(textarea, { target: { value: "first\nsecond" } });

    expect(textarea).toHaveValue("firstsecond");
  });
});
