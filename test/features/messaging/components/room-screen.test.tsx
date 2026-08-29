/* eslint-disable testing-library/no-node-access */
import { act, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoomScreen } from "~/features/messaging/components/room-screen";
import { loadConversation } from "~/features/messaging/data/queries";
import { renderRoute, screen, within } from "../../../router";

const originalVisualViewport = window.visualViewport;

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: originalVisualViewport,
  });
});

function ControlledRoomScreen({
  conversation,
}: {
  conversation: Parameters<typeof RoomScreen>[0]["conversation"];
}) {
  const [desktopDetailsOpen, setDesktopDetailsOpen] = useState(true);

  return (
    <RoomScreen
      conversation={conversation}
      desktopDetailsOpen={desktopDetailsOpen}
      onDesktopDetailsOpenChange={setDesktopDetailsOpen}
    />
  );
}

function SwitchableRoomScreen({
  conversation,
  nextConversation,
}: {
  conversation: Parameters<typeof RoomScreen>[0]["conversation"];
  nextConversation: Parameters<typeof RoomScreen>[0]["conversation"];
}) {
  const [activeConversation, setActiveConversation] = useState(conversation);

  return (
    <>
      <button
        type="button"
        onClick={() => setActiveConversation(nextConversation)}
      >
        대화 변경
      </button>
      <RoomScreen conversation={activeConversation} />
    </>
  );
}

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
    expect(
      screen.getByText("수정할 부분 있으면 오늘 안에 알려주세요."),
    ).toHaveClass("text-[15px]");
    const senderAvatar = within(
      screen
        .getByText("수정할 부분 있으면 오늘 안에 알려주세요.")
        .closest("article")!,
    )
      .getByRole("img", { name: "박서현 프로필 사진" })
      .closest('[data-slot="avatar"]');
    expect(senderAvatar).toHaveAttribute("data-size", "default");
    expect(senderAvatar).toHaveClass("size-7");
    expect(screen.getByLabelText("2명 안 읽음")).toHaveTextContent("2");
    expect(screen.queryByText("안 읽음 2")).not.toBeInTheDocument();
    const reactedMessage = screen
      .getByText("수정할 부분 있으면 오늘 안에 알려주세요.")
      .closest("article")!;
    const reactionGraphic = within(reactedMessage).getByRole("img", {
      name: "좋아요",
    });
    expect(reactionGraphic).toHaveAttribute("src", "/twemoji/15.1.0/1f44d.svg");
    expect(reactionGraphic).toHaveClass("size-[13px]");
    expect(reactionGraphic.parentElement?.parentElement).toHaveClass(
      "top-full",
      "text-[13px]",
      "-translate-y-2",
      "right-1",
      "border-2",
      "border-background",
      "shadow-none",
    );
    const reactionSummary = reactionGraphic.parentElement!.parentElement!;
    expect(reactionSummary).toHaveClass("gap-1");
    expect(within(reactedMessage).getByText("3")).toHaveClass(
      "font-normal",
      "text-muted-foreground",
    );
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
    expect(screen.getByText("대화 멤버 4명").closest("summary")).toHaveClass(
      "select-none",
    );

    const ownBubble = screen.getByText(
      "확인했습니다! 2층 체험 부스 동선만 조금 넓히면 좋을 것 같아요.",
    );
    expect(within(ownBubble).getByText("오후 3:18")).toBeInTheDocument();
    expect(ownBubble).toHaveClass("[overflow-wrap:anywhere]");

    const firstConnectedMessage = screen
      .getByText("축제 부스 배치 초안 확인했어요?")
      .closest("article")!;
    expect(
      within(firstConnectedMessage).queryByText("오후 3:12"),
    ).not.toBeInTheDocument();
    expect(within(reactedMessage).getByText("오후 3:12")).toBeInTheDocument();
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
    expect(
      within(message)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["메시지 기타 작업", "메시지에 답장", "메시지에 반응"]);

    await user.click(reactionButton);
    const reactionPicker = screen.getByRole("button", {
      name: "하트 반응 남기기",
    }).parentElement?.parentElement;
    expect(reactionPicker).toHaveClass("left-1/2", "-translate-x-1/2");
    await user.click(screen.getByRole("button", { name: "하트 반응 남기기" }));
    expect(within(message).getByRole("img", { name: "하트" })).toHaveAttribute(
      "src",
      "/twemoji/15.1.0/2764.svg",
    );
    expect(
      within(message).getByRole("img", { name: "하트" }).parentElement
        ?.parentElement,
    ).toHaveClass("left-1", "bg-secondary", "text-secondary-foreground");
    expect(
      within(message).getByRole("img", { name: "하트" }).parentElement,
    ).not.toHaveTextContent("1");

    await user.click(reactionButton);
    await user.click(screen.getByRole("button", { name: "하트 반응 남기기" }));
    expect(
      within(message).queryByRole("img", { name: "하트" }),
    ).not.toBeInTheDocument();
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
    expect(await screen.findByRole("menuitem", { name: "복사" })).toHaveClass(
      "cursor-pointer",
    );
    expect(screen.getByRole("menuitem", { name: "고정" })).toHaveClass(
      "cursor-pointer",
    );
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

  it("답장을 전송하고 인용 원문으로 이동하며 삭제된 원문을 표시한다", async () => {
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();
    const originalBody = "축제 부스 배치 초안 확인했어요?".repeat(20);
    conversation!.messages.find(({ id }) => id === "m2")!.body = originalBody;

    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const originalMessage = document.getElementById("message-m2")!;

    await user.click(
      within(originalMessage).getByRole("button", { name: "메시지에 답장" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "메시지 입력" }),
      "확인했어요.",
    );
    await user.click(screen.getByRole("button", { name: "메시지 보내기" }));

    const sentReply = screen
      .getAllByRole("article", { name: "내 메시지" })
      .at(-1)!;
    expect(sentReply.firstElementChild).toHaveClass("w-[88%]", "md:w-[78%]");
    const replyQuote = within(sentReply).getByRole("button", {
      name: "박서현의 원문 메시지 보기",
    });
    expect(replyQuote).toHaveTextContent(originalBody);
    expect(replyQuote).toHaveClass("w-full", "min-w-0", "max-w-full");
    expect(replyQuote.lastElementChild).toHaveClass("truncate");
    expect(replyQuote.parentElement).toHaveClass("w-full");
    expect(replyQuote.parentElement?.parentElement).toHaveClass(
      "flex-1",
      "min-w-0",
    );
    await user.click(replyQuote);
    expect(originalMessage).toHaveClass("ring-2", "ring-primary");

    await user.click(
      within(originalMessage).getByRole("button", { name: "메시지에 답장" }),
    );
    await user.click(screen.getByRole("button", { name: "좋아요 보내기" }));
    const emojiReply = screen
      .getAllByRole("article", { name: "내 메시지" })
      .at(-1)!;
    expect(
      within(emojiReply).getByRole("button", {
        name: "박서현의 원문 메시지 보기",
      }),
    ).toHaveClass("border-primary", "text-muted-foreground");

    const deletedOriginal = screen
      .getAllByRole("article", { name: "최민준 메시지" })
      .find((message) => within(message).queryByText("삭제된 메시지입니다"))!;
    expect(
      within(deletedOriginal).queryByRole("button", { name: "메시지에 답장" }),
    ).not.toBeInTheDocument();
    const deletedReply = screen
      .getAllByRole("article", { name: "박서현 메시지" })
      .find((message) =>
        within(message).queryByRole("button", {
          name: "최민준의 원문 메시지 보기",
        }),
      )!;
    await user.click(
      within(deletedReply).getByRole("button", {
        name: "최민준의 원문 메시지 보기",
      }),
    );
    expect(deletedOriginal).toHaveClass("ring-2", "ring-primary");
  });

  it("모바일 가로 스와이프로 답장을 시작한다", async () => {
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/student-council",
    });
    const message = screen
      .getByText("축제 부스 배치 초안 확인했어요?")
      .closest("article")!;

    fireEvent.pointerDown(message, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 20,
      clientY: 100,
    });
    fireEvent.pointerUp(message, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 72,
      clientY: 104,
    });

    expect(screen.getByText("박서현에게 답장")).toBeInTheDocument();
  });

  it("모바일 롱프레스로 반응과 메시지 작업을 표시한다", async () => {
    vi.useFakeTimers();
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/student-council",
    });
    const message = screen
      .getByText("축제 부스 배치 초안 확인했어요?")
      .closest("article")!;
    const actionRail = within(message).getByRole("button", {
      name: "메시지에 반응",
    }).parentElement?.parentElement;
    const messageViewport = screen
      .getByRole("region", { name: "학생회 기획부 대화" })
      .querySelector(".overflow-y-auto")!;
    const messageSurface = message.children[1].lastElementChild!;
    vi.spyOn(message, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 20, y: 600, width: 320, height: 50 }),
    );
    vi.spyOn(messageSurface, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 48, y: 600, width: 220, height: 50 }),
    );
    vi.spyOn(messageViewport, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 100, width: 360, height: 600 }),
    );
    expect(actionRail).toHaveClass("hidden", "[@media(hover:hover)]:flex");
    expect(message.children[1]).toHaveClass("max-w-[88%]", "md:max-w-[78%]");

    fireEvent.touchStart(message, {
      touches: [{ clientX: 120, clientY: 200 }],
    });
    act(() => void vi.advanceTimersByTime(500));

    const backdrop = document.querySelector(
      '[data-slot="message-context-backdrop"]',
    );
    expect(backdrop).toHaveClass("z-40", "bg-background/90");
    expect(
      backdrop?.closest('[data-slot="message-context-portal"]'),
    ).toBeInTheDocument();
    expect(message).toHaveClass(
      "z-50",
      "duration-200",
      "[@media(hover:none)]:select-none",
      "motion-reduce:transition-none",
    );
    expect(message).toHaveStyle({
      transform: "translate3d(0, -225px, 0)",
    });
    expect(screen.getByRole("menu")).toHaveClass(
      "duration-0",
      "data-open:animate-none",
      "data-closed:animate-none",
    );
    expect(
      screen.getByRole("button", { name: "하트 반응 남기기" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "답장" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "복사" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "고정" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "답장" }).parentElement,
    ).toHaveClass(
      "absolute",
      "top-[calc(100%+var(--message-context-height)+1rem)]",
    );
    expect(screen.getByRole("menu")).toHaveStyle({
      "--message-context-height": "50px",
    });

    const replyItem = screen.getByRole("menuitem", { name: "답장" });
    const heartReaction = screen.getByRole("button", {
      name: "하트 반응 남기기",
    });
    fireEvent.touchEnd(message);
    fireEvent.click(replyItem, { pointerType: "touch" });
    expect(screen.queryByText("박서현에게 답장")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.touchStart(heartReaction, {
      touches: [{ clientX: 120, clientY: 200 }],
    });
    fireEvent.touchEnd(heartReaction);
    fireEvent.click(heartReaction, { pointerType: "touch" });
    expect(
      within(message).getByRole("img", { name: "하트" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(message).not.toHaveClass("z-50");
    expect(message).toHaveStyle({ transform: "translate3d(0, 0px, 0)" });
  });

  it("짧거나 이동한 모바일 터치에서는 메시지 작업을 열지 않는다", async () => {
    vi.useFakeTimers();
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/student-council",
    });
    const message = screen
      .getByText("축제 부스 배치 초안 확인했어요?")
      .closest("article")!;

    fireEvent.touchStart(message, {
      touches: [{ clientX: 120, clientY: 200 }],
    });
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.touchEnd(message);
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.touchStart(message, {
      touches: [{ clientX: 120, clientY: 200 }],
    });
    fireEvent.touchMove(message, {
      touches: [{ clientX: 135, clientY: 200 }],
    });
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("롱프레스 직후의 지연된 터치 click에도 중앙 위치를 유지한다", async () => {
    vi.useFakeTimers();
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/student-council",
    });
    const message = screen
      .getByText("축제 부스 배치 초안 확인했어요?")
      .closest("article")!;
    const messageViewport = screen
      .getByRole("region", { name: "학생회 기획부 대화" })
      .querySelector(".overflow-y-auto")!;
    const messageSurface = message.children[1].lastElementChild!;
    const messageRect = vi
      .spyOn(message, "getBoundingClientRect")
      .mockReturnValue(
        DOMRect.fromRect({ x: 20, y: 600, width: 320, height: 50 }),
      );
    vi.spyOn(messageSurface, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 48, y: 600, width: 220, height: 50 }),
    );
    vi.spyOn(messageViewport, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 100, width: 360, height: 600 }),
    );

    fireEvent.touchStart(message, {
      touches: [{ clientX: 120, clientY: 200 }],
    });
    act(() => void vi.advanceTimersByTime(500));
    fireEvent.touchEnd(message);
    fireEvent.click(message, { pointerType: "touch" });
    fireEvent.contextMenu(message, { clientX: 120, clientY: 200 });

    expect(messageRect).toHaveBeenCalledTimes(1);
    expect(message).toHaveClass("z-50");
    expect(message).toHaveStyle({
      transform: "translate3d(0, -225px, 0)",
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("키보드가 닫혀 visual viewport가 바뀌면 작업 위치를 다시 측정한다", async () => {
    vi.useFakeTimers();
    const visualViewport = new EventTarget();
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/student-council",
    });
    const message = screen
      .getByText("축제 부스 배치 초안 확인했어요?")
      .closest("article")!;
    const messageViewport = screen
      .getByRole("region", { name: "학생회 기획부 대화" })
      .querySelector(".overflow-y-auto")!;
    const messageSurface = message.children[1].lastElementChild!;
    const messageRect = vi
      .spyOn(message, "getBoundingClientRect")
      .mockReturnValue(
        DOMRect.fromRect({ x: 20, y: 600, width: 320, height: 50 }),
      );
    const messageSurfaceRect = vi
      .spyOn(messageSurface, "getBoundingClientRect")
      .mockReturnValue(
        DOMRect.fromRect({ x: 48, y: 600, width: 220, height: 50 }),
      );
    vi.spyOn(messageViewport, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 100, width: 360, height: 300 }),
    );

    fireEvent.touchStart(message, {
      touches: [{ clientX: 120, clientY: 200 }],
    });
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getByRole("menu")).toHaveStyle({
      "--message-context-height": "50px",
    });

    messageRect.mockReturnValue(
      DOMRect.fromRect({ x: 20, y: 325, width: 320, height: 60 }),
    );
    messageSurfaceRect.mockReturnValue(
      DOMRect.fromRect({ x: 48, y: 325, width: 220, height: 60 }),
    );
    act(() => {
      visualViewport.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(16);
    });

    expect(messageRect).toHaveBeenCalledTimes(2);
    expect(messageSurfaceRect).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("menu")).toHaveStyle({
      "--message-context-height": "60px",
    });
  });

  it("롱프레스 손가락의 스크림 click을 막고 다음 스크림 탭으로 닫는다", async () => {
    vi.useFakeTimers();
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/student-council",
    });
    const message = screen
      .getByText("축제 부스 배치 초안 확인했어요?")
      .closest("article")!;
    const messageViewport = screen
      .getByRole("region", { name: "학생회 기획부 대화" })
      .querySelector(".overflow-y-auto")!;
    const messageSurface = message.children[1].lastElementChild!;
    vi.spyOn(message, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 20, y: 600, width: 320, height: 50 }),
    );
    vi.spyOn(messageSurface, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 48, y: 600, width: 220, height: 50 }),
    );
    vi.spyOn(messageViewport, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 100, width: 360, height: 600 }),
    );

    fireEvent.touchStart(message, {
      touches: [{ clientX: 120, clientY: 200 }],
    });
    act(() => void vi.advanceTimersByTime(500));
    const backdrop = document.querySelector(
      '[data-slot="message-context-backdrop"]',
    )!;

    fireEvent.touchEnd(message);
    fireEvent.click(backdrop, { pointerType: "touch" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(message).toHaveClass("z-50");
    expect(message).toHaveStyle({
      transform: "translate3d(0, -225px, 0)",
    });

    fireEvent.touchStart(backdrop, {
      touches: [{ clientX: 16, clientY: 16 }],
    });
    fireEvent.touchEnd(backdrop);
    fireEvent.click(backdrop, { pointerType: "touch" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(message).not.toHaveClass("z-50");
    expect(message).toHaveStyle({ transform: "translate3d(0, 0px, 0)" });
  });

  it("두 진입점에서 고정 메시지 목록을 열고 원문 이동과 고정 해제를 제공한다", async () => {
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();
    const conversationWithPinnedMetadata = {
      ...conversation!,
      messages: conversation!.messages.map((message) => {
        if (message.id === "m4") return { ...message, pinned: true };
        if (message.id === "m5") {
          return {
            ...message,
            reactions: [{ reaction: "like" as const, count: 3 }],
          };
        }
        return message;
      }),
    };

    const { user } = renderRoute(
      () => <RoomScreen conversation={conversationWithPinnedMetadata} />,
      { path: "/messenger/student-council" },
    );

    await user.click(screen.getByRole("button", { name: "고정 메시지" }));
    let dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "고정된 메시지" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("2026년 8월 28일 금요일"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("최민준")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("img", { name: "최민준 프로필 사진" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("오후 3:25")).toBeInTheDocument();
    expect(within(dialog).queryByText("고정됨")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("3명 읽음")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("img", { name: "좋아요" }),
    ).not.toBeInTheDocument();

    const otherPinnedMessage = within(dialog)
      .getByRole("link", { name: "https://www.kmlaonline.net" })
      .closest("article")!;
    const ownPinnedMessageBeforeActions = within(dialog)
      .getByText(
        "확인했습니다! 2층 체험 부스 동선만 조금 넓히면 좋을 것 같아요.",
      )
      .closest("article")!;
    expect(
      within(otherPinnedMessage)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["채팅에서 보기", "고정 취소"]);
    expect(
      within(ownPinnedMessageBeforeActions)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["고정 취소", "채팅에서 보기"]);

    const linkedMessage = within(dialog)
      .getByRole("link", { name: "https://www.kmlaonline.net" })
      .closest("article")!;
    await user.click(
      within(linkedMessage).getByRole("button", { name: "채팅에서 보기" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen
        .getByRole("link", { name: "https://www.kmlaonline.net" })
        .closest("article"),
    ).toHaveClass("ring-2", "ring-primary");

    await user.click(screen.getByRole("button", { name: /고정된 메시지\s*2/ }));
    dialog = screen.getByRole("dialog");
    const linkedPinnedMessage = within(dialog)
      .getByRole("link", { name: "https://www.kmlaonline.net" })
      .closest("article")!;
    await user.click(
      within(linkedPinnedMessage).getByRole("button", { name: "고정 취소" }),
    );
    const ownPinnedMessage = within(dialog)
      .getByText(
        "확인했습니다! 2층 체험 부스 동선만 조금 넓히면 좋을 것 같아요.",
      )
      .closest("article")!;
    await user.click(
      within(ownPinnedMessage).getByRole("button", { name: "고정 취소" }),
    );

    expect(within(dialog).getByText("고정된 메시지가 없습니다")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "고정 메시지" }),
    ).not.toBeInTheDocument();
  });

  it("메시지를 입력해 전송하고 빈 입력에서는 좋아요를 보낸다", async () => {
    const conversation = await loadConversation("hyunwoo");
    expect(conversation).not.toBeNull();

    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      {
        path: "/messenger/hyunwoo",
      },
    );
    const input = screen.getByRole("textbox", { name: "메시지 입력" });
    const likeButton = screen.getByRole("button", { name: "좋아요 보내기" });
    const messageThread = screen
      .getByRole("region", { name: "이현우 대화" })
      .querySelector(".overflow-y-auto")!;
    Object.defineProperty(messageThread, "scrollHeight", {
      configurable: true,
      value: 500,
    });

    await user.type(input, "첫 줄{Shift>}{Enter}{/Shift}둘째 줄");
    expect(
      await screen.findByRole("button", { name: "메시지 보내기" }),
    ).toBeEnabled();
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      screen.getAllByRole("article", { name: "내 메시지" }).at(-1),
    ).toHaveTextContent(/첫 줄\s*둘째 줄/);
    expect(messageThread.scrollTop).toBe(500);
    expect(screen.getByRole("button", { name: "좋아요 보내기" })).toBeEnabled();
    await user.click(likeButton);
    const sentLike = screen.getByLabelText("좋아요");
    expect(sentLike.querySelector("svg")).toHaveClass("size-[1em]");
    const sentLikeSurface = sentLike.parentElement!;
    expect(sentLikeSurface).toHaveClass("text-5xl");
    expect(sentLikeSurface).not.toHaveClass("rounded-2xl", "bg-primary");

    await user.type(input, "😀😃😄😁😆");
    await user.click(screen.getByRole("button", { name: "메시지 보내기" }));
    expect(screen.getByText("😀😃😄😁😆")).toHaveClass("text-5xl");

    await user.type(input, "😀😃😄😁😆😅");
    await user.click(screen.getByRole("button", { name: "메시지 보내기" }));
    expect(screen.getByText("😀😃😄😁😆😅")).toHaveClass(
      "rounded-2xl",
      "bg-primary",
    );
  });

  it("대화방을 열면 맨 아래로 이동하고 위로 스크롤하면 하단 이동 버튼을 표시한다", async () => {
    const conversation = await loadConversation("hyunwoo");
    const nextConversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();
    expect(nextConversation).not.toBeNull();

    const { user } = renderRoute(
      () => (
        <SwitchableRoomScreen
          conversation={conversation!}
          nextConversation={nextConversation!}
        />
      ),
      { path: "/messenger/hyunwoo" },
    );
    const messageThread = screen
      .getByRole("region", { name: "이현우 대화" })
      .querySelector(".overflow-y-auto")!;
    Object.defineProperties(messageThread, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    const scrollTo = vi.fn();
    Object.defineProperty(messageThread, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    await user.click(screen.getByRole("button", { name: "대화 변경" }));
    expect(messageThread.scrollTop).toBe(500);
    expect(messageThread.firstElementChild).toHaveClass("justify-start");
    expect(messageThread.firstElementChild).not.toHaveClass("justify-end");

    messageThread.scrollTop = 150;
    fireEvent.scroll(messageThread);
    const scrollToBottomButton = screen.getByRole("button", {
      name: "맨 아래로 이동",
    });
    expect(scrollToBottomButton).toHaveClass(
      "bottom-4",
      "left-1/2",
      "-translate-x-1/2",
      "z-10",
      "border-border",
      "bg-background/95",
      "shadow-md",
    );
    expect(scrollToBottomButton.querySelector("svg")).toHaveClass("size-5");
    await user.click(scrollToBottomButton);
    fireEvent.scroll(messageThread);

    expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: "smooth" });
    expect(
      screen.queryByRole("button", { name: "맨 아래로 이동" }),
    ).not.toBeInTheDocument();
  });

  it("작성 중 첨부 아이콘을 접고 화살표, 입력 비움 및 전송으로 복원한다", async () => {
    const conversation = await loadConversation("hyunwoo");
    expect(conversation).not.toBeNull();

    const { user } = renderRoute(
      () => <ControlledRoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );
    const input = screen.getByRole("textbox", { name: "메시지 입력" });
    const attachmentActions = screen.getByRole("button", {
      name: "파일 첨부 기능 준비 중",
    }).parentElement!;

    await user.type(input, "안녕하세요");
    expect(attachmentActions).toHaveClass("w-0", "opacity-0");
    expect(
      screen.getByRole("button", { name: "첨부 메뉴 펼치기" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "첨부 메뉴 펼치기" }));
    expect(attachmentActions).toHaveClass("w-[5.5rem]", "opacity-100");
    expect(
      screen.queryByRole("button", { name: "첨부 메뉴 펼치기" }),
    ).not.toBeInTheDocument();

    await user.clear(input);
    expect(attachmentActions).toHaveClass("w-[5.5rem]", "opacity-100");

    await user.type(input, "전송할 메시지");
    await user.click(screen.getByRole("button", { name: "메시지 보내기" }));
    expect(attachmentActions).toHaveClass("w-[5.5rem]", "opacity-100");
  });

  it("IME 조합 중 Enter는 전송하지 않고 모바일에서 이모지 버튼을 숨긴다", async () => {
    const conversation = await loadConversation("hyunwoo");
    expect(conversation).not.toBeNull();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/hyunwoo",
    });
    const input = screen.getByRole("textbox", { name: "메시지 입력" });
    const fileButton = screen.getByRole("button", {
      name: "파일 첨부 기능 준비 중",
    });
    const emojiButton = screen.getByRole("button", {
      name: "이모지 선택 기능 준비 중",
    });

    expect(fileButton).not.toHaveClass("hidden");
    expect(emojiButton).toHaveClass("hidden", "md:inline-flex");
    expect(emojiButton.querySelector("svg")).toHaveClass("size-5");
    fireEvent.change(input, { target: { value: "안녕하세" } });
    expect(
      await screen.findByRole("button", { name: "메시지 보내기" }),
    ).toBeEnabled();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getAllByRole("article")).toHaveLength(3);

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      screen.getAllByRole("article", { name: "내 메시지" }).at(-1),
    ).toHaveTextContent("안녕하세");
  });

  it("넓은 화면의 대화 상세 패널을 접고 다시 펼친다", async () => {
    const conversation = await loadConversation("hyunwoo");
    expect(conversation).not.toBeNull();

    const { user } = renderRoute(
      () => <ControlledRoomScreen conversation={conversation!} />,
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
    expect(
      screen.getByText("좋아, 도서관 앞에서 보자").closest("article")
        ?.parentElement?.parentElement,
    ).toHaveClass("xl:max-w-none");

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
