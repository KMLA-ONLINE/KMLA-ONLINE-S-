import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createBrowserRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { LegalDocument } from "~/features/auth/components/legal-document";

const MARKDOWN = `# 개인정보 처리방침

[보유 기간](#4-보유-기간)

## 4. 보유 기간

탈퇴할 때까지 보유합니다.

문의: help@example.com, [Supabase](https://supabase.com/privacy)
`;

// 돌아가기는 브라우저 기록을 보므로 메모리 라우터가 아니라 실제 기록 위에서 그린다.
function openFromSettings() {
  window.history.replaceState(null, "", "/settings");
  const router = createBrowserRouter([
    { path: "/", element: <h1>홈</h1> },
    { path: "/settings", element: <h1>설정</h1> },
    {
      path: "/privacy-policy",
      element: <LegalDocument markdown={MARKDOWN} />,
    },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

describe("LegalDocument", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("returns to the previous screen", async () => {
    const user = userEvent.setup();
    const router = openFromSettings();
    await act(() => router.navigate("/privacy-policy"));

    await user.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(
      await screen.findByRole("heading", { name: "설정" }),
    ).toBeInTheDocument();
  });

  // 문서 안 링크가 기록을 하나 더 쌓으면 그 항목에는 라우터의 순번이 없어, 새 탭으로 연 것처럼 홈으로 갔다.
  it("returns to the previous screen after following a section link", async () => {
    const user = userEvent.setup();
    const router = openFromSettings();
    await act(() => router.navigate("/privacy-policy"));

    await user.click(screen.getByRole("link", { name: "보유 기간" }));
    await user.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(
      await screen.findByRole("heading", { name: "설정" }),
    ).toBeInTheDocument();
  });

  // 메일 링크를 새 탭으로 열면 메일 앱과 함께 빈 탭이 남는다.
  it("opens web links in a new tab but not mail links", async () => {
    const router = openFromSettings();
    await act(() => router.navigate("/privacy-policy"));

    expect(
      screen.getByRole("link", { name: "help@example.com" }),
    ).not.toHaveAttribute("target");
    expect(screen.getByRole("link", { name: "Supabase" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });
});
