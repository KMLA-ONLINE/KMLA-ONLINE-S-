import { afterEach, describe, expect, it, vi } from "vitest";

import { MessagingScreen } from "~/features/messaging/components/messaging-screen";
import { listConversations } from "~/features/messaging/data/queries";
import { renderRoute, screen, within } from "../../../router";
import { resetFakeMessaging } from "../fake-api";

vi.mock("~/features/messaging/data/queries", () => import("../fake-api"));

// 테스트가 고친 목 데이터(읽음, 알림 끄기, 멤버)가 다음 테스트로 새지 않게 한다.
afterEach(() => resetFakeMessaging());
vi.mock("~/features/messaging/data/mutations", () => import("../fake-api"));

describe("MessagingScreen", () => {
  it("새 대화에서 한 명을 고르면 1:1 대화를, 여러 명이면 이름을 받아 그룹을 열고 그 대화로 간다", async () => {
    const conversations = await listConversations();
    const { user } = renderRoute(
      () => (
        <MessagingScreen conversations={conversations} hasRoom={false}>
          <div />
        </MessagingScreen>
      ),
      {
        path: "/messenger",
        routes: [
          { path: "/messenger/:roomId", Component: () => <p>열린 대화</p> },
        ],
      },
    );

    await user.click(screen.getByRole("button", { name: "새 대화" }));
    const dialog = await screen.findByRole("dialog", { name: "새 대화" });
    await user.type(within(dialog).getByRole("searchbox"), "새봄{Enter}");
    await user.click(
      await within(dialog).findByRole("button", { name: /최새봄/ }),
    );
    expect(
      within(dialog).queryByRole("textbox", { name: "그룹 이름" }),
    ).not.toBeInTheDocument();

    await user.clear(within(dialog).getByRole("searchbox"));
    await user.type(within(dialog).getByRole("searchbox"), "여름{Enter}");
    await user.click(
      await within(dialog).findByRole("button", { name: /정여름/ }),
    );
    const create = within(dialog).getByRole("button", { name: "그룹 만들기" });
    expect(create).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: "그룹 이름" }),
      "새 모임",
    );
    await user.click(create);

    expect(await screen.findByText("열린 대화")).toBeInTheDocument();
  });

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
  });

  it("알림 꺼짐 상태를 대화 이름 옆에 표시한다", async () => {
    const conversations = await listConversations();

    renderRoute(
      () => (
        <MessagingScreen conversations={conversations} hasRoom={false}>
          {null}
        </MessagingScreen>
      ),
      { path: "/messenger" },
    );

    const conversationLink = screen.getByRole("link", {
      name: /과학전람회 준비/,
    });
    const mutedIcon = within(conversationLink).getByLabelText("알림 꺼짐");

    expect(mutedIcon.parentElement).toHaveTextContent("과학전람회 준비");
    expect(mutedIcon.parentElement).not.toHaveTextContent(
      "은재: 실험 결과 파일 올렸습니다",
    );
  });
});
