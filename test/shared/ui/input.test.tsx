import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "~/shared/ui/input";

describe("Input autocomplete", () => {
  it("disables autocomplete by default", () => {
    render(<Input aria-label="검색" />);

    expect(screen.getByRole("textbox", { name: "검색" })).toHaveAttribute(
      "autocomplete",
      "off",
    );
  });

  it("allows an explicit autocomplete purpose", () => {
    render(<Input aria-label="이메일" autoComplete="email" />);

    expect(screen.getByRole("textbox", { name: "이메일" })).toHaveAttribute(
      "autocomplete",
      "email",
    );
  });
});
