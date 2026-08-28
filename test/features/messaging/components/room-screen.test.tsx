import { describe, expect, it } from "vitest";

import { RoomScreen } from "~/features/messaging/components/room-screen";
import { loadConversation } from "~/features/messaging/data/queries";
import { renderRoute, screen, within } from "../../../router";

describe("RoomScreen", () => {
  it("그룹 대화의 메시지와 대표 상태를 표시한다", async () => {
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();
    conversation!.messages.at(-1)!.pinned = true;

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/student-council",
    });

    expect(
      screen.getByRole("heading", { name: "학생회 기획부", level: 1 }),
    ).toBeInTheDocument();
    const pinnedBanner = screen.getByLabelText("고정 메시지");
    expect(within(pinnedBanner).getByText("박서현")).toBeInTheDocument();
    expect(
      within(pinnedBanner).getByText("내일 점심시간에 최종 확인할게요!"),
    ).toBeInTheDocument();
    expect(
      within(pinnedBanner).queryByText("고정된 메시지"),
    ).not.toBeInTheDocument();
    const dayLabel = screen.getByText("2026년 8월 28일 금요일");
    expect(dayLabel).not.toHaveClass("rounded-full", "bg-muted");
    expect(
      screen.getByRole("link", { name: "https://www.kmlaonline.net" }),
    ).toHaveAttribute("href", "https://www.kmlaonline.net");
    expect(screen.getByLabelText("3명 읽음")).toHaveTextContent("3");
    expect(screen.queryByText("읽음 3")).not.toBeInTheDocument();
    expect(screen.getByText("👍 3")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "프로필 기능 준비 중" }),
    ).not.toBeInTheDocument();

    const pinnedMessage = screen
      .getByRole("link", { name: "https://www.kmlaonline.net" })
      .closest("article")!;
    const pinnedLabel =
      within(pinnedMessage).getByText("고정됨").parentElement!;
    expect(pinnedLabel).toHaveTextContent("최민준·고정됨");
    expect(pinnedLabel).toHaveClass("gap-1");

    expect(screen.queryByText("4명 · 2명 활동 중")).not.toBeInTheDocument();
    expect(screen.queryByText("활동 중")).not.toBeInTheDocument();
    expect(screen.getByText("대화 멤버 4명")).toBeInTheDocument();

    const ownBubble = screen.getByText(
      "확인했습니다! 2층 체험 부스 동선만 조금 넓히면 좋을 것 같아요.",
    );
    expect(within(ownBubble).getByText("오후 3:18")).toBeInTheDocument();
  });

  it("메시지 반응을 로컬에서 선택하고 제거한다", async () => {
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();

    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const message = screen.getByText("고마워요 🙌").closest("article")!;

    const reactionButton = within(message).getByRole("button", {
      name: "메시지에 반응",
    });
    expect(reactionButton).toHaveClass("size-8");
    expect(reactionButton.parentElement).not.toHaveClass(
      "border",
      "bg-background",
      "shadow-sm",
    );
    expect(reactionButton.parentElement?.parentElement).toHaveClass(
      "items-center",
    );

    await user.click(reactionButton);
    await user.click(screen.getByRole("button", { name: "하트 반응 남기기" }));
    expect(within(message).getByText("❤️ 1")).toBeInTheDocument();

    await user.click(reactionButton);
    await user.click(screen.getByRole("button", { name: "하트 반응 남기기" }));
    expect(within(message).queryByText("❤️ 1")).not.toBeInTheDocument();
  });

  it("답장 대상을 표시하고 기타 메뉴에서 메시지를 고정한다", async () => {
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();

    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const body = "축제 부스 배치 초안 확인했어요?";
    const message = screen.getByText(body).closest("article")!;

    await user.click(
      within(message).getByRole("button", { name: "메시지에 답장" }),
    );
    expect(screen.getByText("박서현에게 답장")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "답장 취소" }));
    expect(screen.queryByText("박서현에게 답장")).not.toBeInTheDocument();

    await user.click(
      within(message).getByRole("button", { name: "메시지 기타 작업" }),
    );
    expect(await screen.findByRole("menu")).toHaveClass(
      "duration-0",
      "shadow-sm",
      "data-open:animate-none",
      "data-closed:animate-none",
    );
    expect(await screen.findByRole("menuitem", { name: "복사" })).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "고정" }));
    expect(screen.getAllByText(body)).toHaveLength(1);
    expect(screen.getByLabelText("고정 메시지")).not.toHaveTextContent(body);
    expect(within(message).getByText("고정됨")).toBeInTheDocument();

    const ownMessage = screen.getByText("고마워요 🙌").closest("article")!;
    await user.click(
      within(ownMessage).getByRole("button", { name: "메시지 기타 작업" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "고정" }));
    expect(within(ownMessage).getByText("고정됨")).toBeInTheDocument();
    expect(screen.getAllByText("고마워요 🙌")).toHaveLength(2);
  });

  it("넓은 화면의 대화 상세 패널을 접고 다시 펼친다", async () => {
    const conversation = await loadConversation("hyunwoo");
    expect(conversation).not.toBeNull();

    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );

    expect(
      screen.getByRole("button", { name: "프로필 기능 준비 중" }),
    ).toBeDisabled();
    expect(screen.queryByText("현재 활동 중")).not.toBeInTheDocument();

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
