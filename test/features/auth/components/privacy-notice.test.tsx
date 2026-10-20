import { describe, expect, it } from "vitest";

import { PrivacyNotice } from "~/features/auth/components/privacy-notice";
import privacyNotice from "../../../../docs/legal/privacy_notice.md?raw";
import { renderRoute, screen } from "../../../router";

// 문구는 docs/legal/privacy_notice.md 1항이 소유한다.
const section = privacyNotice.split(/^## 1\. .+$/m)[1].split(/^## /m)[0];
const items = [...section.matchAll(/^- \*\*(.+)\*\*: (.+)$/gm)].map(
  ([, term, detail]) => [term, detail],
);

describe("PrivacyNotice", () => {
  it("shows every item of the privacy notice", () => {
    renderRoute(() => <PrivacyNotice />);

    expect(
      screen.getByRole("heading", { name: "개인정보 처리 안내" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "선택 정보" })).toBeVisible();
    expect(items).toHaveLength(8);
    for (const [term, detail] of items) {
      expect(screen.getByText(term)).toBeVisible();
      expect(screen.getByText(detail)).toBeVisible();
    }
  });

  // 가입 중에 떠나면 폼 안의 이메일·비밀번호가 사라지므로 새 탭으로 연다.
  it("opens the privacy policy in this app in a new tab", () => {
    renderRoute(() => <PrivacyNotice />);

    const link = screen.getByRole("link", { name: "개인정보 처리방침" });
    expect(link).toHaveAttribute("href", "/privacy-policy");
    expect(link).toHaveAttribute("target", "_blank");
  });
});
