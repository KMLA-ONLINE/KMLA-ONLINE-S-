import { describe, expect, it } from "vitest";

import { RoomScreen } from "~/features/messaging/components/room-screen";
import { loadConversation } from "~/features/messaging/data/queries";
import { renderRoute, screen } from "../../../router";

describe("RoomScreen", () => {
  it("그룹 대화의 메시지와 대표 상태를 표시한다", async () => {
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/student-council",
    });

    expect(
      screen.getByRole("heading", { name: "학생회 기획부", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("고정된 메시지").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "https://www.kmlaonline.net" }),
    ).toHaveAttribute("href", "https://www.kmlaonline.net");
    expect(screen.getByText("읽음 3")).toBeInTheDocument();
    expect(screen.getByText("👍 3")).toBeInTheDocument();
  });

  it("넓은 화면의 대화 상세 패널을 접고 다시 펼친다", async () => {
    const conversation = await loadConversation("hyunwoo");
    expect(conversation).not.toBeNull();

    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );

    const closeButton = screen.getByRole("button", { name: "대화 정보 닫기" });
    expect(closeButton).toHaveAttribute("aria-pressed", "true");

    await user.click(closeButton);
    const openButton = screen.getByRole("button", {
      name: "대화 정보 열기",
      pressed: false,
    });
    expect(openButton).toHaveAttribute("aria-pressed", "false");

    await user.click(openButton);
    expect(
      screen.getByRole("button", { name: "대화 정보 닫기" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("좁은 화면에서는 상세 화면으로 전환하고 돌아온다", async () => {
    const conversation = await loadConversation("hyunwoo");
    expect(conversation).not.toBeNull();

    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );

    const conversationRegion = screen.getByRole("region", {
      name: "이현우 대화",
    });
    await user.click(
      screen.getAllByRole("button", { name: "대화 정보 열기" })[0],
    );
    expect(conversationRegion).toHaveClass("hidden", "xl:flex");

    await user.click(screen.getByRole("button", { name: "대화로 돌아가기" }));
    expect(conversationRegion).toHaveClass("flex");
  });
});
