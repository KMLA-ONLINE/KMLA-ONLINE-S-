import { screen, waitFor } from "@testing-library/react";
import { useLocation, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";

import { useReactionListParam } from "~/features/posts/hooks/use-reaction-list-param";
import { renderRoute } from "../../../router";

function Opener({ label, target }: { label: string; target: string }) {
  const list = useReactionListParam(target);
  return (
    <section aria-label={label}>
      <button type="button" onClick={list.show}>
        {label} 열기
      </button>
      {list.open ? (
        <div role="dialog" aria-label={`${label} 목록`}>
          <button type="button" onClick={list.close}>
            닫기
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Screen() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      {/* 피드 카드와 그 위에 뜬 상세처럼 같은 게시물의 버튼이 둘이다. */}
      <Opener label="카드" target="post:p1" />
      <Opener label="상세" target="post:p1" />
      <Opener label="댓글" target="comment:c1" />
      <output aria-label="주소">{location.search}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        뒤로
      </button>
    </>
  );
}

function renderScreen() {
  return renderRoute(Screen, {
    path: "/",
    initialEntries: ["/", "/?post=p1"],
    initialIndex: 1,
  });
}

describe("useReactionListParam", () => {
  it("closes on back and returns to the screen it opened over", async () => {
    const { user } = renderScreen();

    await user.click(screen.getByRole("button", { name: "상세 열기" }));
    expect(screen.getByRole("dialog", { name: "상세 목록" })).toBeVisible();
    expect(screen.getByLabelText("주소")).toHaveTextContent(
      "?post=p1&reactions=post%3Ap1",
    );

    await user.click(screen.getByRole("button", { name: "뒤로" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // 한 번의 뒤로가기는 목록만 닫는다. 밑에 깔린 상세는 그대로다.
    expect(screen.getByLabelText("주소")).toHaveTextContent("?post=p1");
  });

  it("opens only the list of the button that was pressed", async () => {
    const { user } = renderScreen();

    await user.click(screen.getByRole("button", { name: "상세 열기" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.queryByRole("dialog", { name: "카드 목록" }),
    ).not.toBeInTheDocument();
  });

  it("closes its own list by popping the entry it pushed", async () => {
    const { user } = renderScreen();

    await user.click(screen.getByRole("button", { name: "댓글 열기" }));
    await user.click(screen.getByRole("button", { name: "닫기" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("주소")).toHaveTextContent("?post=p1");
  });

  it("does not open a list from a pasted address alone", () => {
    renderRoute(Screen, {
      path: "/",
      initialEntries: ["/?reactions=post%3Ap1"],
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
