import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AdminContactList } from "~/features/support/components/admin-contact-list";

describe("AdminContactList", () => {
  it("hides contacts behind the situational prompt until asked", async () => {
    const user = userEvent.setup();
    render(
      <AdminContactList
        prompt="승인이 너무 오래 걸리나요?"
        contacts={[
          {
            kind: "link",
            label: "오픈채팅",
            value: "https://open.kakao.com/o/abc",
          },
          { kind: "email", label: "학생회 메일", value: "council@kmla.hs.kr" },
        ]}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "승인이 너무 오래 걸리나요?" }),
    );

    const link = screen.getByRole("link", {
      name: "https://open.kakao.com/o/abc",
    });
    expect(link).toHaveAttribute("href", "https://open.kakao.com/o/abc");
    expect(link).toHaveAttribute("target", "_blank");
    const email = screen.getByRole("link", { name: "council@kmla.hs.kr" });
    expect(email).toHaveAttribute("href", "mailto:council@kmla.hs.kr");
    expect(email).not.toHaveAttribute("target");
  });

  it("renders nothing when no contact is set", () => {
    const { container } = render(
      <AdminContactList prompt="문의" contacts={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
