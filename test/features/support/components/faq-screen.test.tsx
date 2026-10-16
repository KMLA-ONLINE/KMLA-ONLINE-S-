import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FaqScreen } from "~/features/support/components/faq-screen";
import { faqSections } from "~/features/support/content/faq";
import type { FaqSection } from "~/features/support";
import { renderRoute } from "../../../router";

const sections: FaqSection[] = [
  {
    id: "account",
    title: "계정",
    items: [
      { question: "승인은 언제 되나요?", answer: <>관리자가 확인합니다.</> },
    ],
  },
];

describe("FaqScreen", () => {
  it("explains device notifications separately from the inbox and keeps the device/account scope", async () => {
    const { user } = renderRoute(() => <FaqScreen sections={faqSections} contacts={[]} />);
    await user.click(screen.getByText("기기 알림이 뭔가요?"));
    expect(screen.getByText("휴대폰이나 컴퓨터에 뜨는 알림입니다. 앱을 보고 있지 않아도 기기 알림으로 옵니다.")).toBeVisible();
    await user.click(screen.getByText("기기 알림을 껐는데 앱 안에는 알림이 왜 떠요?"));
    expect(screen.getByText("기기 알림과 앱 안의 알림함은 별개입니다. 기기 알림을 꺼도 앱 안 알림은 남을 수 있습니다.")).toBeVisible();
    await user.click(screen.getByText("알림 설정을 바꾸면 다른 기기에도 똑같이 적용되나요?"));
    expect(screen.getByText(/기기 알림 전체 켜기\/끄기는 지금 쓰는 기기에만 적용됩니다/)).toBeVisible();
  });

  it("links password and notification help to the settings URLs", async () => {
    const { user } = renderRoute(() => (
      <FaqScreen sections={faqSections} contacts={[]} />
    ));
    await user.click(screen.getByText("비밀번호를 바꾸고 싶어요."));
    expect(screen.getByRole("link", { name: "비밀번호 변경" })).toHaveAttribute(
      "href",
      "/settings/password",
    );
    await user.click(screen.getByText("그룹별 알림은 어떻게 설정하나요?"));
    await user.click(
      screen.getByText("알림 설정을 바꾸면 다른 기기에도 똑같이 적용되나요?"),
    );
    for (const link of screen.getAllByRole("link", { name: "알림 설정" })) {
      expect(link).toHaveAttribute("href", "/settings/noti");
    }
  });
  it("keeps every answer collapsed until its question is opened", () => {
    renderRoute(() => <FaqScreen sections={sections} contacts={[]} />);

    expect(screen.getByText("승인은 언제 되나요?")).toBeInTheDocument();
    expect(screen.getByText("관리자가 확인합니다.")).not.toBeVisible();
  });

  it("reveals the answer when the question is activated", async () => {
    const { user } = renderRoute(() => (
      <FaqScreen sections={sections} contacts={[]} />
    ));

    await user.click(screen.getByText("승인은 언제 되나요?"));

    expect(screen.getByText("관리자가 확인합니다.")).toBeVisible();
  });

  it("hides the contact card when no channel is configured", () => {
    renderRoute(() => <FaqScreen sections={sections} contacts={[]} />);

    expect(screen.queryByText("문의")).not.toBeInTheDocument();
  });

  it("shows the contact card for a note alone, with no link to follow", () => {
    renderRoute(() => (
      <FaqScreen
        sections={sections}
        contacts={[]}
        note="문의 그룹을 이용해 주세요."
      />
    ));

    expect(screen.getByText("문의")).toBeInTheDocument();
    expect(screen.getByText("문의 그룹을 이용해 주세요.")).toBeInTheDocument();
  });

  it("opens external contacts in a new tab and app paths through the router", () => {
    renderRoute(() => (
      <FaqScreen
        sections={sections}
        contacts={[
          { label: "메일", to: "mailto:help@example.com" },
          { label: "공지", to: "/groups" },
          { label: "안내", to: "https://example.com" },
        ]}
      />
    ));

    expect(screen.getByRole("link", { name: "메일" })).not.toHaveAttribute(
      "target",
    );
    expect(screen.getByRole("link", { name: "공지" })).toHaveAttribute(
      "href",
      "/groups",
    );
    expect(screen.getByRole("link", { name: "안내" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("shows an empty state when there is nothing to answer yet", () => {
    renderRoute(() => <FaqScreen sections={[]} contacts={[]} />);

    expect(screen.getByText("등록된 도움말이 없습니다")).toBeInTheDocument();
  });
});
