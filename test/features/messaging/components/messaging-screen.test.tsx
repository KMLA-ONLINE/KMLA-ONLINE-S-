import { describe, expect, it } from "vitest";

import { MessagingScreen } from "~/features/messaging/components/messaging-screen";
import { listConversations } from "~/features/messaging/data/queries";
import { renderRoute, screen } from "../../../router";

describe("MessagingScreen", () => {
  it("대화 목록을 검색하고 현재 대화를 표시한다", async () => {
    const conversations = await listConversations();

    function TestScreen() {
      return (
        <MessagingScreen
          conversations={conversations}
          selectedRoomId="student-council"
          hasRoom
        >
          <div>선택한 대화</div>
        </MessagingScreen>
      );
    }

    const { user } = renderRoute(TestScreen, {
      path: "/messenger/:roomId",
      initialEntries: ["/messenger/student-council"],
    });

    expect(screen.getByRole("link", { name: /학생회 기획부/ })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.type(
      screen.getByRole("searchbox", { name: "대화 검색" }),
      "현우",
    );

    expect(
      await screen.findByRole("link", { name: /이현우/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /학생회 기획부/ }),
    ).not.toBeInTheDocument();
  });

  it("검색 결과가 없으면 빈 상태를 표시한다", async () => {
    const conversations = await listConversations();

    function TestScreen() {
      return (
        <MessagingScreen conversations={conversations} hasRoom={false}>
          {null}
        </MessagingScreen>
      );
    }

    const { user } = renderRoute(TestScreen, { path: "/messenger" });
    await user.type(
      screen.getByRole("searchbox", { name: "대화 검색" }),
      "존재하지 않는 대화",
    );

    expect(
      await screen.findByText("대화를 찾지 못했습니다"),
    ).toBeInTheDocument();
    expect(screen.getByText("대화를 선택하세요")).toBeInTheDocument();
  });
});
