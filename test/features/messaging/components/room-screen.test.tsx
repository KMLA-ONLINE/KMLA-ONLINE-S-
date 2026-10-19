import { type QueryClient, useQueryClient } from "@tanstack/react-query";
/* eslint-disable testing-library/no-node-access */
import { act, fireEvent, waitFor } from "@testing-library/react";
import { type ComponentProps, useEffect, useState } from "react";
import type * as ContextMenuModule from "@base-ui/react/context-menu";
import type * as InstallPlatformModule from "~/shared/lib/install-platform";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { RoomScreen } from "~/features/messaging/components/room-screen";
import { mergeServerMessages } from "~/features/messaging/data/cache";
import * as mutations from "~/features/messaging/data/mutations";
import * as queries from "~/features/messaging/data/queries";
import { clearRoomDrafts } from "~/features/messaging/hooks/room-drafts";
import { loadConversation } from "~/features/messaging/data/queries";
import type { Conversation } from "~/features/messaging/model/types";
import { mentionDisplayText } from "~/features/posts/model/mentions";
import { ENTER_TO_SEND_STORAGE_KEY } from "~/shared/lib/enter-to-send";
import { renderRoute, screen, within } from "../../../router";
import { resetFakeMessaging } from "../fake-api";

vi.mock("~/features/messaging/data/queries", () => import("../fake-api"));

const handheld = vi.hoisted(() => ({ value: false }));
vi.mock("~/shared/lib/install-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof InstallPlatformModule>()),
  isHandheld: () => handheld.value,
}));

// 테스트가 고친 목 데이터(읽음, 알림 끄기, 멤버)와 쓰다 둔 초안이 다음 테스트로 새지 않게 한다.
afterEach(() => {
  resetFakeMessaging();
  clearRoomDrafts();
});
vi.mock("~/features/messaging/data/mutations", () => import("../fake-api"));
vi.mock("~/features/messaging/data/files", () => ({
  prepareAttachment: (file: File) =>
    Promise.resolve({
      kind: "file",
      file,
      thumbnail: null,
      fileName: file.name,
      width: null,
      height: null,
    }),
  uploadAttachments: (
    _conversationId: string,
    messageId: string,
    prepared: { fileName: string; file: File }[],
  ) =>
    Promise.resolve(
      prepared.map((item, index) => ({
        id: `${messageId}-a${index}`,
        kind: "file",
        mimeType: item.file.type,
        sizeBytes: item.file.size,
        width: null,
        height: null,
        fileName: item.fileName,
        objectPath: `c/${messageId}-${index}`,
        thumbnailPath: null,
      })),
    ),
  createAttachmentUrls: (paths: string[]) =>
    Promise.resolve(
      new Map(paths.map((path) => [path, `https://signed/${path}`])),
    ),
  toDownloadUrl: (url: string, name: string) => `${url}?download=${name}`,
  loadPlayableAttachment: () => Promise.resolve(null),
}));

type ContextMenuPositionerProps = ComponentProps<
  typeof ContextMenuModule.ContextMenu.Positioner
>;

const positionerSpy = vi.hoisted(() =>
  vi.fn<(props: ContextMenuPositionerProps) => void>(),
);

vi.mock("@base-ui/react/context-menu", async (importOriginal) => {
  const actual = await importOriginal<typeof ContextMenuModule>();

  function Positioner(
    props: ComponentProps<typeof actual.ContextMenu.Positioner>,
  ) {
    positionerSpy(props);
    return <actual.ContextMenu.Positioner {...props} />;
  }

  return {
    ...actual,
    ContextMenu: { ...actual.ContextMenu, Positioner },
  };
});

const originalVisualViewport = window.visualViewport;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  positionerSpy.mockClear();
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

/**
 * 고정 메시지는 서버가 대화방과 함께 따로 준다. fixture의 메시지를 고정으로 바꾼 테스트는 그 목록도
 * 같은 상태로 맞춘다.
 */
function syncPinned<T extends Conversation>(conversation: T): T {
  return {
    ...conversation,
    pinnedMessages: conversation.messages.filter(
      (message) => message.pinned && !message.system,
    ),
  };
}

/** 이동한 메시지의 강조는 말풍선 테두리로만 드러난다. */
function bubble(message: Element) {
  return message.querySelector('[data-slot="message-bubble"]');
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
  it.each([
    ["iPhone", true],
    ["iPad", true],
    ["Android", false],
  ])(
    "keeps composer safe-area padding keyboard-aware only on iOS (%s)",
    async (platform, ios) => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform);
      const viewport = Object.assign(new EventTarget(), {
        height: window.innerHeight,
        offsetTop: 0,
        scale: 1,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
      const conversation = await loadConversation("student-council");
      renderRoute(() => <RoomScreen conversation={conversation!} />, {
        path: "/messenger/student-council",
      });
      const composer = screen
        .getByRole("textbox", { name: "메시지 입력" })
        .closest("footer")!;
      const safeAreaPadding = "pb-[calc(0.5rem+var(--app-safe-b))]";
      expect(composer).toHaveClass(safeAreaPadding);

      act(() => {
        viewport.height = window.innerHeight - 300;
        viewport.dispatchEvent(new Event("resize"));
      });
      if (ios) {
        expect(composer).toHaveClass("pb-0");
        expect(composer).not.toHaveClass(safeAreaPadding);
      } else {
        expect(composer).toHaveClass(safeAreaPadding);
        expect(composer).not.toHaveClass("pb-0");
      }

      act(() => {
        viewport.height = window.innerHeight;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(composer).toHaveClass(safeAreaPadding);
      expect(composer).not.toHaveClass("pb-0");
    },
  );

  it.each(["iPhone", "Android"])(
    "anchors the room header and composer to the keyboard viewport (%s)",
    async (platform) => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform);
      const viewport = Object.assign(new EventTarget(), {
        height: window.innerHeight,
        offsetTop: 0,
        scale: 1,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
      const conversation = await loadConversation("student-council");
      renderRoute(() => <RoomScreen conversation={conversation!} />, {
        path: "/messenger/student-council",
      });
      const room = screen.getByRole("region", {
        name: "학생회 기획부 채팅",
      }).parentElement!;
      const header = screen.getByRole("heading", {
        name: "학생회 기획부",
        level: 1,
      });
      act(() => {
        viewport.height = window.innerHeight - 300;
        viewport.offsetTop = 100;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(header).toBeVisible();
      if (platform === "iPhone") {
        expect(room).toHaveStyle({
          "--room-keyboard-height": `${viewport.height}px`,
        });
        expect(room).toHaveClass("max-md:top-(--room-keyboard-top)");
        expect(room).not.toHaveClass("max-md:bottom-(--room-keyboard-bottom)");
        expect(room).toHaveStyle({ "--room-keyboard-top": "100px" });
        act(() => {
          viewport.offsetTop = 200;
          viewport.dispatchEvent(new Event("scroll"));
        });
        expect(room).toHaveStyle({ "--room-keyboard-top": "200px" });
      } else {
        expect(room).not.toHaveClass("max-md:fixed");
        expect(room).not.toHaveClass("max-md:bottom-(--room-keyboard-bottom)");
        expect(room).not.toHaveClass("max-md:top-(--room-keyboard-top)");
        expect(room).not.toHaveAttribute("style");
      }
      act(() => {
        viewport.height = window.innerHeight;
        viewport.offsetTop = 0;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(room).not.toHaveClass("max-md:fixed");
      expect(header).toBeVisible();
    },
  );

  it.each(["iPhone", "Android"])(
    "uses the document height only on iOS when the installed app resizes innerHeight (%s)",
    async (platform) => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform);
      vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
        812,
      );
      const previousHeight = window.innerHeight;
      const viewport = Object.assign(new EventTarget(), {
        height: 443,
        offsetTop: 369,
        scale: 1,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 443,
      });
      try {
        const conversation = await loadConversation("student-council");
        renderRoute(() => <RoomScreen conversation={conversation!} />, {
          path: "/messenger/student-council",
        });
        const room = screen.getByRole("region", {
          name: "학생회 기획부 채팅",
        }).parentElement!;
        const footer = screen
          .getByRole("textbox", { name: "메시지 입력" })
          .closest("footer")!;
        if (platform === "iPhone") {
          expect(room).toHaveClass("max-md:fixed");
          expect(room).toHaveStyle({
            "--room-keyboard-height": "443px",
            "--room-keyboard-top": "369px",
          });
          expect(footer).toHaveClass("pb-0");
        } else {
          expect(room).not.toHaveClass("max-md:fixed");
          expect(footer).toHaveClass("pb-[calc(0.5rem+var(--app-safe-b))]");
        }
      } finally {
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: previousHeight,
        });
      }
    },
  );

  it("그룹 대화의 메시지와 대표 상태를 표시한다", async () => {
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();
    conversation!.messages.at(-1)!.pinned = true;
    const pinnedConversation = syncPinned(conversation!);

    renderRoute(() => <RoomScreen conversation={pinnedConversation} />, {
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
    expect(screen.getByText("2026년 8월 28일 금요일")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://www.kmlaonline.net" }),
    ).toHaveAttribute("href", "https://www.kmlaonline.net");
    expect(screen.getByLabelText("2명 안 읽음")).toHaveTextContent("2");
    const reactedMessage = screen
      .getByText("수정할 부분 있으면 오늘 안에 알려주세요.")
      .closest("article")!;
    const reactionGraphic = within(reactedMessage).getByRole("img", {
      name: "좋아요",
    });
    expect(reactionGraphic).toHaveAttribute("src", "/twemoji/15.1.0/1f44d.svg");
    expect(within(reactedMessage).getByText("3")).toBeInTheDocument();

    const pinnedMessage = screen
      .getByRole("link", { name: "https://www.kmlaonline.net" })
      .closest("article")!;
    const pinnedLabel =
      within(pinnedMessage).getByText("고정됨").parentElement!;
    expect(pinnedLabel).toHaveTextContent("최민준·고정됨");
    expect(screen.getByText("채팅 멤버 4명")).toBeInTheDocument();
  });

  it("메시지 반응을 로컬에서 선택하고 제거한다", async () => {
    // 반응은 0.5초 안에 다시 바꾸지 않으므로 시계를 고정해 두고 필요한 만큼만 넘긴다.
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
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
    await user.click(reactionButton);
    await user.click(screen.getByRole("button", { name: "하트 반응 남기기" }));
    expect(within(message).getByRole("img", { name: "하트" })).toHaveAttribute(
      "src",
      "/twemoji/15.1.0/2764.svg",
    );

    // 같은 메시지의 반응은 0.5초 안에 다시 바꾸지 않는다.
    await user.click(reactionButton);
    await user.click(screen.getByRole("button", { name: "하트 반응 취소" }));
    expect(within(message).getByRole("img", { name: "하트" })).toBeVisible();

    now.mockReturnValue(1_001_000);
    await user.click(reactionButton);
    await user.click(screen.getByRole("button", { name: "하트 반응 취소" }));
    expect(
      within(message).queryByRole("img", { name: "하트" }),
    ).not.toBeInTheDocument();
    now.mockRestore();
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
    await user.click(await screen.findByRole("menuitem", { name: "고정" }));
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

  it("폰의 화면 키보드에서는 Enter가 보내지 않고 줄을 바꾼다", async () => {
    handheld.value = true;
    try {
      const conversation = await loadConversation("student-council");
      const { user } = renderRoute(
        () => <RoomScreen conversation={conversation!} />,
        { path: "/messenger/student-council" },
      );
      const input = screen.getByRole("textbox", { name: "메시지 입력" });

      await user.type(input, "첫 줄");
      // 화면 키보드는 실제 키 위치가 없어 `code`가 빈 문자열이다. user-event의 {Enter}는 물리 키다.
      // 줄바꿈은 브라우저 기본 동작이라 jsdom에서는 일어나지 않는다. 막지 않았는지와 보내지 않았는지를 본다.
      expect(fireEvent.keyDown(input, { key: "Enter", code: "" })).toBe(true);
      expect(input).toHaveValue("첫 줄");
    } finally {
      handheld.value = false;
    }
  });

  it("폰·태블릿에 물리 키보드를 연결하면 Enter로 보내고 Shift+Enter로 줄을 바꾼다", async () => {
    handheld.value = true;
    try {
      const conversation = await loadConversation("student-council");
      const { user } = renderRoute(
        () => <RoomScreen conversation={conversation!} />,
        { path: "/messenger/student-council" },
      );
      const input = screen.getByRole("textbox", { name: "메시지 입력" });

      await user.type(input, "첫 줄{Shift>}{Enter}{/Shift}둘째 줄");
      expect(input).toHaveValue("첫 줄\n둘째 줄");
      await user.type(input, "{Enter}");

      await waitFor(() =>
        expect(
          screen.getAllByRole("article", { name: "내 메시지" }).at(-1),
        ).toHaveTextContent(/첫 줄\s*둘째 줄/),
      );
      expect(input).toHaveValue("");
    } finally {
      handheld.value = false;
    }
  });

  it("Enter로 보내기를 끄면 데스크톱에서도 Enter가 줄을 바꾼다", async () => {
    window.localStorage.setItem(ENTER_TO_SEND_STORAGE_KEY, "off");
    try {
      const conversation = await loadConversation("student-council");
      const { user } = renderRoute(
        () => <RoomScreen conversation={conversation!} />,
        { path: "/messenger/student-council" },
      );
      const input = screen.getByRole("textbox", { name: "메시지 입력" });

      await user.type(input, "첫 줄{Enter}둘째 줄");
      expect(input).toHaveValue("첫 줄\n둘째 줄");
    } finally {
      window.localStorage.removeItem(ENTER_TO_SEND_STORAGE_KEY);
    }
  });

  it("내 메시지를 15분 안에 고친다", async () => {
    // 목 메시지는 고정된 시각에 보냈으므로 그 직후로 시계를 맞춘다.
    // 이 파일은 spy를 일괄 복원하지 않으므로 테스트 끝에서 직접 되돌린다.
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-08-28T15:32:00+09:00"));
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const ownMessage = () => document.getElementById("message-m6")!;

    await user.click(
      within(ownMessage()).getByRole("button", { name: "메시지 기타 작업" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "수정" }));
    expect(screen.getByText("메시지 수정")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "메시지 입력" });
    expect(input).toHaveValue("고마워요 🙌");

    await user.clear(input);
    await user.type(input, "고쳤어요{Enter}");
    expect(await within(ownMessage()).findByText("수정됨")).toBeInTheDocument();
    expect(screen.queryByText("메시지 수정")).not.toBeInTheDocument();
    expect(input).toHaveValue("");
    now.mockRestore();
  });

  it("고치는 사이 15분이 지나면 보내지 않고 이유를 알리며 수정 모드를 끝낸다", async () => {
    // 이 파일은 spy를 일괄 복원하지 않으므로 테스트 끝에서 직접 되돌린다.
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-08-28T15:32:00+09:00"));
    const editSpy = vi.spyOn(mutations, "editMessage");
    const toastError = vi.spyOn(toast, "error");
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const ownMessage = document.getElementById("message-m6")!;

    await user.click(
      within(ownMessage).getByRole("button", { name: "메시지 기타 작업" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "수정" }));
    const input = screen.getByRole("textbox", { name: "메시지 입력" });
    await user.clear(input);
    now.mockReturnValue(Date.parse("2026-08-28T16:00:00+09:00"));
    await user.type(input, "늦은 수정{Enter}");

    expect(toastError).toHaveBeenCalledWith(
      "보낸 지 15분이 지나 수정할 수 없습니다.",
    );
    expect(editSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("메시지 수정")).not.toBeInTheDocument();
    editSpy.mockRestore();
    toastError.mockRestore();
    now.mockRestore();
  });

  it("수정 저장에 실패하면 고치던 입력과 수정 모드를 되살리고, 조합 중 Esc로는 취소하지 않는다", async () => {
    // 이 파일은 spy를 일괄 복원하지 않으므로 테스트 끝에서 직접 되돌린다.
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-08-28T15:32:00+09:00"));
    vi.spyOn(mutations, "editMessage").mockRejectedValueOnce(
      new Error("offline"),
    );
    const toastError = vi.spyOn(toast, "error");
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const ownMessage = () => document.getElementById("message-m6")!;

    await user.click(
      within(ownMessage()).getByRole("button", { name: "메시지 기타 작업" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "수정" }));
    const input = screen.getByRole("textbox", { name: "메시지 입력" });
    await user.clear(input);
    await user.type(input, "실패할 수정{Enter}");

    expect(await screen.findByText("메시지 수정")).toBeInTheDocument();
    expect(input).toHaveValue("실패할 수정");
    expect(toastError).toHaveBeenCalledWith("메시지를 수정하지 못했습니다.");
    expect(within(ownMessage()).queryByText("수정됨")).not.toBeInTheDocument();

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("메시지 수정")).toBeInTheDocument();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("메시지 수정")).not.toBeInTheDocument();
    now.mockRestore();
    toastError.mockRestore();
  });

  it("대화에서 찾은 메시지를 고르면 검색을 닫고 그 메시지로 이동해 강조한다", async () => {
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const messageThread = screen
      .getByRole("region", { name: "학생회 기획부 채팅" })
      .querySelector(".overflow-y-auto")!;
    const scrollTo = vi.fn();
    Object.defineProperty(messageThread, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    await user.click(screen.getByRole("button", { name: "채팅 검색" }));
    const searchBox = screen.getByRole("searchbox", { name: "채팅에서 찾기" });
    expect(searchBox).toHaveFocus();
    await user.type(searchBox, "부스 배치{Enter}");

    const results = await screen.findByRole("list", { name: "검색 결과" });
    const result = within(results).getByRole("button", {
      name: /축제 부스 배치 초안/,
    });
    expect(result).toHaveTextContent("박서현");
    await user.click(result);

    expect(
      screen.queryByRole("searchbox", { name: "채팅에서 찾기" }),
    ).not.toBeInTheDocument();
    // 대화 영역만 움직인다. `scrollIntoView`는 바깥 틀까지 밀어 화면 전체가 밀린다.
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "smooth" }),
      ),
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    // 다시 열면 입력과 결과가 남아 있어 다음 결과를 이어 고른다. 찾은 말은 따로 표시한다.
    await user.click(screen.getByRole("button", { name: "채팅 검색" }));
    expect(
      screen.getByRole("searchbox", { name: "채팅에서 찾기" }),
    ).toHaveValue("부스 배치");
    const reopened = screen.getByRole("list", { name: "검색 결과" });
    expect(within(reopened).getAllByText("부스 배치")[0]?.tagName).toBe("MARK");
  });

  it("삭제 모드와 답장은 Esc로 끝낸다", async () => {
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const ownMessage = document.getElementById("message-m6")!;
    await user.click(
      within(ownMessage).getByRole("button", { name: "메시지 기타 작업" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "삭제" }));
    expect(screen.getByText("1개 선택됨")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("1개 선택됨")).not.toBeInTheDocument();

    const message = document.getElementById("message-m3")!;
    await user.click(
      within(message).getByRole("button", { name: "메시지에 답장" }),
    );
    expect(screen.getByRole("textbox", { name: "메시지 입력" })).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "답장 취소" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("button", { name: "답장 취소" }),
    ).not.toBeInTheDocument();
  });

  it("쓰던 글과 쌓아 둔 첨부는 대화방을 떠났다 돌아와도 남는다", async () => {
    const conversation = await loadConversation("hyunwoo");
    const view = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );
    await view.user.type(
      screen.getByRole("textbox", { name: "메시지 입력" }),
      "쓰다 만 글",
    );
    fireEvent.drop(
      screen.getByRole("textbox", { name: "메시지 입력" }).closest("footer")!,
      {
        dataTransfer: {
          types: ["Files"],
          files: [
            new File(["hello"], "회의록.pdf", { type: "application/pdf" }),
          ],
        },
      },
    );
    view.unmount();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/hyunwoo",
    });
    expect(screen.getByRole("textbox", { name: "메시지 입력" })).toHaveValue(
      "쓰다 만 글",
    );
    expect(
      within(screen.getByRole("list", { name: "보낼 첨부" })).getByText(
        "회의록.pdf",
      ),
    ).toBeInTheDocument();
  });

  it("답장 중에는 끌어 놓은 파일을 쌓지 않는다", async () => {
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const message = screen
      .getByText("축제 부스 배치 초안 확인했어요?")
      .closest("article")!;
    await user.click(
      within(message).getByRole("button", { name: "메시지에 답장" }),
    );

    fireEvent.drop(
      screen.getByRole("textbox", { name: "메시지 입력" }).closest("footer")!,
      {
        dataTransfer: {
          types: ["Files"],
          files: [
            new File(["hello"], "회의록.pdf", { type: "application/pdf" }),
          ],
        },
      },
    );

    expect(
      screen.queryByRole("list", { name: "보낼 첨부" }),
    ).not.toBeInTheDocument();
  });

  it("삭제를 누르면 그 메시지를 고른 삭제 모드가 되고, 더 고른 뒤 한 번에 지운다", async () => {
    const removeMany = vi.spyOn(mutations, "deleteMessages");
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const ownMessage = document.getElementById("message-m6")!;

    await user.click(
      within(ownMessage).getByRole("button", { name: "메시지 기타 작업" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "삭제" }));
    expect(screen.getByText("1개 선택됨")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "메시지 입력" }),
    ).not.toBeInTheDocument();
    // 남의 메시지는 고를 수 없고, 반응이나 답장도 받지 않는다.
    expect(
      within(document.getElementById("message-m3")!.parentElement!).queryByRole(
        "button",
        {
          name: "메시지 선택",
        },
      ),
    ).not.toBeInTheDocument();
    expect(
      document.getElementById("message-m3")!.parentElement,
    ).toHaveAttribute("inert");

    await user.click(
      within(document.getElementById("message-m4")!.parentElement!).getByRole(
        "button",
        {
          name: "메시지 선택",
        },
      ),
    );
    expect(screen.getByText("2개 선택됨")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "삭제" }));

    await waitFor(() =>
      expect(removeMany).toHaveBeenCalledWith(
        expect.arrayContaining(["m4", "m6"]),
      ),
    );
    expect(
      await within(document.getElementById("message-m6")!).findByText(
        "삭제된 메시지입니다",
      ),
    ).toBeInTheDocument();
    // 지운 메시지에는 더 할 작업이 없다.
    expect(
      within(document.getElementById("message-m6")!).queryByRole("button", {
        name: "메시지 기타 작업",
      }),
    ).not.toBeInTheDocument();
    removeMany.mockRestore();
  });

  it("고른 파일을 메시지로 보내고 이름과 크기, 내려받기 링크를 보인다", async () => {
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const fileInput =
      document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];

    await user.upload(
      fileInput,
      new File(["hello"], "회의록.pdf", { type: "application/pdf" }),
    );

    const download = await screen.findByRole("link", {
      name: "내려받기: 회의록.pdf",
    });
    expect(download).toHaveAttribute(
      "href",
      expect.stringContaining("download=회의록.pdf"),
    );
    expect(download).toHaveTextContent("5B");
  });

  it("끌어 놓거나 붙여 넣은 첨부는 작성창 위에 두었다가 전송할 때 보낸다", async () => {
    // jsdom에는 Blob URL이 없다. 쌓아 둔 사진의 미리보기용으로만 채운다.
    const created = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revoked = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.assign(URL, {
      createObjectURL: () => "blob:preview",
      revokeObjectURL: () => undefined,
    });
    const sendSpy = vi.spyOn(mutations, "sendMessage");
    const conversation = await loadConversation("hyunwoo");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );
    const input = screen.getByRole("textbox", { name: "메시지 입력" });

    fireEvent.drop(input.closest("footer")!, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["hello"], "회의록.pdf", { type: "application/pdf" })],
      },
    });
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "",
        items: [
          {
            kind: "file",
            getAsFile: () =>
              new File(["png"], "캡처.png", { type: "image/png" }),
          },
        ],
      },
    });

    const tray = screen.getByRole("list", { name: "보낼 첨부" });
    expect(within(tray).getAllByRole("listitem")).toHaveLength(2);
    expect(sendSpy).not.toHaveBeenCalled();

    await user.click(
      within(tray).getByRole("button", { name: "첨부 빼기: 캡처.png" }),
    );
    await user.click(screen.getByRole("button", { name: "메시지 보내기" }));

    expect(
      await screen.findByRole("link", { name: "내려받기: 회의록.pdf" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "보낼 첨부" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByAltText("캡처.png")).not.toBeInTheDocument();
    sendSpy.mockRestore();
    for (const [name, descriptor] of [
      ["createObjectURL", created],
      ["revokeObjectURL", revoked],
    ] as const) {
      if (descriptor) Object.defineProperty(URL, name, descriptor);
      else Reflect.deleteProperty(URL, name);
    }
  });

  it("대화 정보에서 멤버를 초대하고, 다른 멤버를 내보낼 수는 없다", async () => {
    const invite = vi.spyOn(mutations, "addConversationMembers");
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );

    await user.click(screen.getByRole("button", { name: "멤버 초대" }));
    const dialog = await screen.findByRole("dialog", { name: "멤버 초대" });
    await user.type(within(dialog).getByRole("searchbox"), "새봄{Enter}");
    await user.click(
      await within(dialog).findByRole("button", { name: /최새봄/ }),
    );
    await user.click(within(dialog).getByRole("button", { name: "초대" }));
    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith("student-council", ["new-1"]),
    );

    expect(
      screen.queryByRole("button", { name: /내보내기/ }),
    ).not.toBeInTheDocument();
    invite.mockRestore();
  });

  it("소유주는 확인을 거쳐 대화방을 지우고 대화 목록으로 돌아간다", async () => {
    const remove = vi.spyOn(mutations, "deleteGroupConversation");
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      {
        path: "/messenger/student-council",
        routes: [{ path: "/messenger", Component: () => <p>대화 목록</p> }],
      },
    );

    await user.click(screen.getByRole("button", { name: "채팅방 삭제" }));
    await user.click(await screen.findByRole("button", { name: "삭제" }));

    expect(await screen.findByText("대화 목록")).toBeInTheDocument();
    expect(remove).toHaveBeenCalledWith("student-council");
    remove.mockRestore();
  });

  it("소유주가 아니면 대화방 삭제가 보이지 않는다", async () => {
    const conversation = await loadConversation("science-project");
    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/science-project",
    });

    expect(
      screen.queryByRole("button", { name: "채팅방 삭제" }),
    ).not.toBeInTheDocument();
  });

  it("그룹 이름을 바꾸고, 나가면 목록에서 빼고 대화 목록으로 돌아간다", async () => {
    const conversation = await loadConversation("science-project");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      {
        path: "/messenger/science-project",
        routes: [{ path: "/messenger", Component: () => <p>대화 목록</p> }],
      },
    );

    await user.click(screen.getByRole("button", { name: "그룹 이름 변경" }));
    const nameInput = await screen.findByRole("textbox", { name: "그룹 이름" });
    await user.clear(nameInput);
    await user.type(nameInput, "과학전람회 본선{Enter}");
    expect(
      await screen.findByRole("heading", { name: "과학전람회 본선", level: 1 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "그룹 나가기" }));
    await user.click(await screen.findByRole("button", { name: "나가기" }));
    expect(await screen.findByText("대화 목록")).toBeInTheDocument();
  });

  it("그룹 대화 정보에서 알림 단계를 고른다", async () => {
    const setLevel = vi.spyOn(mutations, "setConversationNotificationLevel");
    const conversation = await loadConversation("student-council");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );

    await user.click(
      screen.getByRole("button", { name: "채팅 알림: 모든 메시지" }),
    );
    await user.click(
      await screen.findByRole("menuitemradio", { name: "멘션만" }),
    );
    expect(setLevel).toHaveBeenLastCalledWith("student-council", "mentions");
    expect(
      await screen.findByRole("button", { name: "채팅 알림: 멘션만" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "채팅 알림: 멘션만" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "끄기" }),
    );
    expect(setLevel).toHaveBeenLastCalledWith("student-council", "off");
    expect(
      await screen.findByRole("button", { name: "채팅 알림: 끄기" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "채팅 알림: 끄기" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "모든 메시지" }),
    );
    expect(setLevel).toHaveBeenLastCalledWith("student-council", "all");
    setLevel.mockRestore();
  });

  it("탈퇴한 상대와의 1:1 대화에는 입력창과 답장·수정을 내지 않는다", async () => {
    const loaded = await loadConversation("hyunwoo");
    const conversation = {
      ...loaded!,
      participants: loaded!.participants.map((participant) =>
        participant.id === loaded!.viewerId
          ? participant
          : { ...participant, name: "탈퇴한 사용자", withdrawn: true },
      ),
    };
    renderRoute(() => <RoomScreen conversation={conversation} />, {
      path: "/messenger/hyunwoo",
    });

    expect(
      screen.getByText("탈퇴한 사용자에게는 메시지를 보낼 수 없습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryAllByRole("button", { name: "메시지에 답장" }),
    ).toHaveLength(0);
  });

  it("열어 둔 1:1 대화의 상대가 탈퇴해 전송이 거부되면 대화를 다시 읽어 입력창을 내린다", async () => {
    const conversation = await loadConversation("hyunwoo");
    const summary = await queries.getConversationSummary("hyunwoo");
    vi.spyOn(mutations, "sendMessage").mockRejectedValueOnce({
      code: "55000",
      message: "recipient withdrawn",
      hint: "recipient_withdrawn",
    });
    vi.spyOn(queries, "getConversationSummary").mockResolvedValue({
      ...summary!,
      name: "탈퇴한 사용자",
      participants: summary!.participants.map((participant) =>
        participant.id === summary!.viewerId
          ? participant
          : { ...participant, name: "탈퇴한 사용자", withdrawn: true },
      ),
    });
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );

    await user.type(
      screen.getByRole("textbox", { name: "메시지 입력" }),
      "안녕{Enter}",
    );

    expect(
      await screen.findByText("탈퇴한 사용자에게는 메시지를 보낼 수 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "메시지 입력" }),
    ).not.toBeInTheDocument();
    // 다시 보내도 같은 이유로 거부되므로 지우기만 남긴다.
    expect(screen.getByText("보내지 못했습니다")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "다시 보내기" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지우기" })).toBeInTheDocument();
  });

  it("1:1 대화 정보에서는 알림을 끄고 다시 켜기만 한다", async () => {
    const setLevel = vi.spyOn(mutations, "setConversationNotificationLevel");
    const conversation = await loadConversation("hyunwoo");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );

    await user.click(screen.getByRole("button", { name: "채팅 알림 끄기" }));
    expect(
      screen.getByRole("button", { name: "채팅 알림 켜기" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(setLevel).toHaveBeenLastCalledWith("hyunwoo", "off");

    await user.click(screen.getByRole("button", { name: "채팅 알림 켜기" }));
    expect(
      screen.getByRole("button", { name: "채팅 알림 끄기" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(setLevel).toHaveBeenLastCalledWith("hyunwoo", "all");
    setLevel.mockRestore();
  });

  it("답장을 전송하고 인용 원문으로 이동하며 삭제된 원문을 표시한다", async () => {
    // 보낸 뒤 0.5초 안의 전송은 받지 않으므로 시계를 매번 넘긴다.
    let clock = Date.now();
    const now = vi
      .spyOn(Date, "now")
      .mockImplementation(() => (clock += 1_000));
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
    const replyQuote = within(sentReply).getByRole("button", {
      name: "박서현의 원문 메시지 보기",
    });
    expect(replyQuote).toHaveTextContent(originalBody);
    await user.click(replyQuote);
    await waitFor(() =>
      expect(bubble(originalMessage)).toHaveClass("ring-primary"),
    );

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
    // 이동은 열린 오버레이를 닫은 뒤에 일어나므로 강조를 기다린다.
    await waitFor(() =>
      expect(bubble(deletedOriginal)).toHaveClass("ring-primary"),
    );
    now.mockRestore();
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
    fireEvent.pointerMove(message, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 40,
      clientY: 102,
    });
    expect(message).toHaveAttribute("data-swiping");
    fireEvent.pointerMove(message, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 84,
      clientY: 104,
    });
    expect(message).toHaveAttribute("data-reply-armed");
    fireEvent.pointerUp(message, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 84,
      clientY: 104,
    });

    expect(screen.getByText("박서현에게 답장")).toBeInTheDocument();
    expect(message).not.toHaveAttribute("data-swiping");
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
    const messageViewport = screen
      .getByRole("region", { name: "학생회 기획부 채팅" })
      .querySelector(".overflow-y-auto")!;
    const messageSurface = message.children[1].lastElementChild!;
    const composer = screen.getByRole("textbox", { name: "메시지 입력" });
    const blurComposer = vi.spyOn(composer, "blur");
    vi.spyOn(message, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 20, y: 600, width: 320, height: 50 }),
    );
    vi.spyOn(messageSurface, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 48, y: 600, width: 220, height: 50 }),
    );
    vi.spyOn(messageViewport, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 100, width: 360, height: 600 }),
    );
    composer.focus();
    fireEvent.touchStart(message, {
      touches: [{ clientX: 120, clientY: 200 }],
    });
    act(() => void vi.advanceTimersByTime(500));

    // 키보드를 내리고 메시지를 보이는 자리로 끌어올린 뒤 메뉴를 연다.
    expect(blurComposer).toHaveBeenCalledOnce();
    expect(message).toHaveStyle({ transform: "translate3d(0, -232.5px, 0)" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.transitionEnd(message, { propertyName: "transform" });
    act(() => void vi.advanceTimersByTime(16));
    expect(
      screen.getByRole("button", { name: "하트 반응 남기기" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "답장" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "복사" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "고정" })).toBeInTheDocument();

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
    // 반응은 Query cache를 거쳐 그려지고, cache 알림은 다음 tick에 묶여 나간다.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(
      within(message).getByRole("img", { name: "하트" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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
      .getByRole("region", { name: "학생회 기획부 채팅" })
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
    fireEvent.transitionEnd(message, { propertyName: "transform" });
    const backdrop = document.querySelector(
      '[data-slot="message-context-backdrop"]',
    )!;

    fireEvent.touchEnd(message);
    fireEvent.click(backdrop, { pointerType: "touch" });
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.touchStart(backdrop, {
      touches: [{ clientX: 16, clientY: 16 }],
    });
    fireEvent.touchEnd(backdrop);
    fireEvent.click(backdrop, { pointerType: "touch" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(message).toHaveStyle({ transform: "translate3d(0, 0px, 0)" });
  });

  it("두 진입점에서 고정 메시지 목록을 열고 원문 이동과 고정 해제를 제공한다", async () => {
    const conversation = await loadConversation("student-council");
    expect(conversation).not.toBeNull();
    const conversationWithPinnedMetadata = syncPinned({
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
    });

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

    const linkedMessage = within(dialog)
      .getByRole("link", { name: "https://www.kmlaonline.net" })
      .closest("article")!;
    await user.click(
      within(linkedMessage).getByRole("button", { name: "채팅에서 보기" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const originalPinnedMessage = screen
      .getByRole("link", { name: "https://www.kmlaonline.net" })
      .closest("article")!;
    expect(bubble(originalPinnedMessage)).toHaveClass("ring-primary");

    // 버튼이 아니라 메시지 자체를 눌러도 원래 메시지로 간다.
    await user.click(screen.getByRole("button", { name: "고정 메시지" }));
    await user.click(
      within(screen.getByRole("dialog")).getByText(
        "확인했습니다! 2층 체험 부스 동선만 조금 넓히면 좋을 것 같아요.",
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      bubble(
        screen
          .getByText(
            "확인했습니다! 2층 체험 부스 동선만 조금 넓히면 좋을 것 같아요.",
          )
          .closest("article")!,
      ),
    ).toHaveClass("ring-primary");

    await user.click(screen.getByRole("button", { name: /고정된 메시지\s*2/ }));
    dialog = screen.getByRole("dialog");
    const linkedPinnedMessage = within(dialog)
      .getByRole("link", { name: "https://www.kmlaonline.net" })
      .closest("article")!;
    await user.click(
      within(linkedPinnedMessage).getByRole("button", { name: "고정 해제" }),
    );
    const ownPinnedMessage = within(dialog)
      .getByText(
        "확인했습니다! 2층 체험 부스 동선만 조금 넓히면 좋을 것 같아요.",
      )
      .closest("article")!;
    await user.click(
      within(ownPinnedMessage).getByRole("button", { name: "고정 해제" }),
    );

    expect(within(dialog).getByText("고정된 메시지가 없습니다")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "고정 메시지" }),
    ).not.toBeInTheDocument();
  });

  it("메시지를 입력해 전송하고 빈 입력에서는 좋아요를 보낸다", async () => {
    // 보낸 뒤 0.5초는 다음 전송을 받지 않는다. 시계를 매번 1초씩 넘겨 그 제한 밖에서 보낸다.
    let clock = Date.now();
    const now = vi
      .spyOn(Date, "now")
      .mockImplementation(() => (clock += 1_000));
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
      .getByRole("region", { name: "이현우 채팅" })
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

    // 보낸 메시지는 Query cache를 거쳐 그려지고, cache 알림은 다음 tick에 묶여 나간다.
    await waitFor(() =>
      expect(
        screen.getAllByRole("article", { name: "내 메시지" }).at(-1),
      ).toHaveTextContent(/첫 줄\s*둘째 줄/),
    );
    expect(messageThread.scrollTop).toBe(500);
    // 보낸 직후에도 버튼은 바로 좋아요가 되지만, 한 번 더 누른 손가락이 좋아요를 보내지는 않는다.
    expect(likeButton).toHaveAccessibleName("좋아요 보내기");
    await user.click(likeButton);
    expect(screen.queryByLabelText("좋아요")).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await user.click(likeButton);
    expect(await screen.findByLabelText("좋아요")).toBeInTheDocument();

    await user.type(input, "버튼으로 보내기");
    await user.click(screen.getByRole("button", { name: "메시지 보내기" }));
    expect(await screen.findByText("버튼으로 보내기")).toBeInTheDocument();
    // 버튼으로 보내도 입력창이 포커스를 잃지 않아야 모바일 키보드가 접히지 않는다.
    expect(input).toHaveFocus();
    now.mockRestore();
  });

  it("보낸 직후 0.5초 안의 전송은 받지 않는다", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const sendSpy = vi.spyOn(mutations, "sendMessage");
    const conversation = await loadConversation("hyunwoo");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );
    const like = screen.getByRole("button", { name: "좋아요 보내기" });

    await user.click(like);
    await user.click(like);
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));

    now.mockReturnValue(1_000_600);
    await user.click(like);
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(2));
    sendSpy.mockRestore();
    now.mockRestore();
  });

  it("iOS keeps the latest message visible when multiline composition shrinks the thread", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
    const callbacks = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) {
          callbacks.set(element, this.callback);
        }
        unobserve(element: Element) {
          callbacks.delete(element);
        }
        disconnect() {
          callbacks.clear();
        }
      },
    );
    const conversation = await loadConversation("hyunwoo");
    let queryClient!: QueryClient;
    function GrabClient() {
      const client = useQueryClient();
      useEffect(() => {
        queryClient = client;
      }, [client]);
      return null;
    }
    renderRoute(
      () => (
        <>
          <GrabClient />
          <RoomScreen conversation={conversation!} />
        </>
      ),
      {
        path: "/messenger/hyunwoo",
      },
    );
    const thread = screen
      .getByRole("region", { name: "이현우 채팅" })
      .querySelector(".overflow-y-auto")!;
    let height = 300;
    let top = 700;
    let scrollHeight = 1000;
    const scrollWrites: number[] = [];
    Object.defineProperties(thread, {
      clientHeight: { configurable: true, get: () => height },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = value;
          scrollWrites.push(value);
        },
      },
    });
    const resize = () => callbacks.get(thread)!([], {} as ResizeObserver);
    act(resize);
    thread.scrollTop = 700;
    fireEvent.scroll(thread);
    // Safari can dispatch scroll before ResizeObserver when the composer grows.
    height = 180;
    fireEvent.scroll(thread);
    act(resize);
    expect(thread.scrollTop).toBe(820);
    scrollWrites.length = 0;
    fireEvent.change(screen.getByRole("textbox", { name: "메시지 입력" }), {
      target: { value: "첫 줄" },
    });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    expect(scrollWrites).toEqual([]);
    // Continued typing may scroll the thread after the resize has already settled.
    fireEvent.change(screen.getByRole("textbox", { name: "메시지 입력" }), {
      target: { value: "첫 줄\n두 번째 줄 타이핑" },
    });
    thread.scrollTop = 650;
    fireEvent.scroll(thread);
    await waitFor(() => expect(thread.scrollTop).toBe(820));
    // Growing the draft must not pull a reader away from older messages.
    thread.scrollTop = 100;
    fireEvent.scroll(thread);
    height = 156;
    fireEvent.scroll(thread);
    act(resize);
    expect(thread.scrollTop).toBe(100);
    // A small expansion must not pull someone reading older messages to bottom.
    thread.scrollTop = 744;
    fireEvent.scroll(thread);
    height = 180;
    act(resize);
    expect(thread.scrollTop).toBe(744);
    scrollHeight = 1100;
    act(() => {
      mergeServerMessages(queryClient, "hyunwoo", [
        {
          id: "while-reading",
          senderId: "hyunwoo-user",
          body: "unseen before keyboard closes",
          sentAt: "2026-09-30T12:11:00+09:00",
        },
      ]);
    });
    await within(thread as HTMLElement).findByText(
      "unseen before keyboard closes",
    );
    height = 300;
    thread.scrollTop = 800;
    fireEvent.scroll(thread);
    act(resize);
    thread.scrollTop = 100;
    fireEvent.scroll(thread);
    expect(
      screen.queryByRole("button", { name: /^새 메시지:/ }),
    ).not.toBeInTheDocument();
    // Closing the keyboard can clamp the list to its bottom before resize delivery.
    scrollHeight = 1000;
    thread.scrollTop = 700;
    fireEvent.scroll(thread);
    act(resize);
    scrollHeight = 1100;
    act(() => {
      mergeServerMessages(queryClient, "hyunwoo", [
        {
          id: "after-dismissal",
          senderId: "hyunwoo-user",
          body: "new reply",
          sentAt: "2026-09-30T12:12:00+09:00",
        },
      ]);
    });
    await within(thread as HTMLElement).findByText("new reply");
    expect(thread.scrollTop).toBe(1100);
    fireEvent.change(screen.getByRole("textbox", { name: "메시지 입력" }), {
      target: { value: "새 메시지를 보며 입력" },
    });
    scrollHeight = 1200;
    act(() => {
      mergeServerMessages(queryClient, "hyunwoo", [
        {
          id: "while-composing",
          senderId: "hyunwoo-user",
          body: "reply while typing",
          sentAt: "2026-09-30T12:13:00+09:00",
        },
      ]);
    });
    await within(thread as HTMLElement).findByText("reply while typing");
    thread.scrollTop = 1200;
    fireEvent.scroll(thread);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    thread.scrollTop = 100;
    fireEvent.pointerDown(thread);
    fireEvent.scroll(thread);
    expect(
      screen.queryByRole("button", { name: /^새 메시지:/ }),
    ).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("맨 아래를 보고 있을 때 새 메시지가 오면 따라 내려가고, 위로 올려 보던 중이면 그대로 둔다", async () => {
    const conversation = await loadConversation("hyunwoo");
    let queryClient!: QueryClient;
    const keepClient = (client: QueryClient) => {
      queryClient = client;
    };
    function GrabClient() {
      const client = useQueryClient();
      useEffect(() => keepClient(client), [client]);
      return null;
    }
    renderRoute(
      () => (
        <>
          <GrabClient />
          <RoomScreen conversation={conversation!} />
        </>
      ),
      { path: "/messenger/hyunwoo" },
    );
    const messageThread = screen
      .getByRole("region", { name: "이현우 채팅" })
      .querySelector(".overflow-y-auto")!;
    let scrollHeight = 500;
    Object.defineProperties(messageThread, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: { configurable: true, writable: true, value: 400 },
    });
    fireEvent.scroll(messageThread);

    const incoming = (id: string, minute: number) => ({
      id,
      senderId: "hyunwoo-user",
      body: id,
      sentAt: `2026-09-30T12:${minute}:00+09:00`,
    });
    scrollHeight = 600;
    act(() => {
      mergeServerMessages(queryClient, "hyunwoo", [incoming("new-1", 10)]);
    });
    expect(await screen.findByText("new-1")).toBeInTheDocument();
    expect(messageThread.scrollTop).toBe(600);

    messageThread.scrollTop = 100;
    fireEvent.scroll(messageThread);
    scrollHeight = 700;
    act(() => {
      mergeServerMessages(queryClient, "hyunwoo", [incoming("new-2", 11)]);
    });
    expect(
      await within(messageThread as HTMLElement).findByText("new-2"),
    ).toBeInTheDocument();
    expect(messageThread.scrollTop).toBe(100);
    // 지난 대화를 보던 중에 온 상대 메시지는 맨 아래 이동 버튼 자리에 미리 보여 준다.
    expect(
      screen.getByRole("button", { name: /^새 메시지: .+, 맨 아래로 이동$/ }),
    ).toHaveTextContent("new-2");
  });

  it("맨 위까지 두 화면 안쪽이면 앞선 메시지를 읽고, 붙인 뒤에도 가까우면 이어 읽는다", async () => {
    const conversation = await loadConversation("hyunwoo", 1);
    expect(conversation?.olderCursor).not.toBeNull();
    let page = 0;
    const listMessages = vi
      .spyOn(queries, "listMessages")
      .mockImplementation(() => {
        page += 1;
        return Promise.resolve({
          messages: [
            {
              id: `older-${page}`,
              senderId: "hyunwoo-user",
              body: `앞선 메시지 ${page}`,
              sentAt: `2026-01-0${4 - page}T09:00:00+09:00`,
            },
          ],
          // 두 페이지 뒤에는 더 앞선 메시지가 없다.
          olderCursor:
            page < 2
              ? {
                  sentAt: `2026-01-0${4 - page}T09:00:00+09:00`,
                  id: `older-${page}`,
                }
              : null,
        });
      });

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/hyunwoo",
    });
    const messageThread = screen
      .getByRole("region", { name: "이현우 채팅" })
      .querySelector(".overflow-y-auto")!;
    // 높이가 변하지 않으므로 페이지를 붙여도 맨 위까지 남은 거리가 그대로다.
    Object.defineProperties(messageThread, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 2000 },
      scrollTop: { configurable: true, writable: true, value: 500 },
    });
    listMessages.mockClear();

    // 맨 위까지 500px. 예전 기준(400px)으로는 읽지 않았지만 두 화면(600px) 안쪽이다.
    fireEvent.scroll(messageThread);

    expect(await screen.findByText("앞선 메시지 2")).toBeInTheDocument();
    expect(screen.getByText("앞선 메시지 1")).toBeInTheDocument();
    // 다시 스크롤하지 않아도 두 번째 페이지까지 이어 읽고, 더 없으면 멈춘다.
    expect(listMessages).toHaveBeenCalledTimes(2);
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
      .getByRole("region", { name: "이현우 채팅" })
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

    messageThread.scrollTop = 150;
    fireEvent.scroll(messageThread);
    const scrollToBottomButton = screen.getByRole("button", {
      name: "맨 아래로 이동",
    });
    await user.click(scrollToBottomButton);
    fireEvent.scroll(messageThread);

    expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: "smooth" });
    expect(
      screen.queryByRole("button", { name: "맨 아래로 이동" }),
    ).not.toBeInTheDocument();
  });

  it("IME 조합 중 Enter는 전송하지 않는다", async () => {
    const conversation = await loadConversation("hyunwoo");
    expect(conversation).not.toBeNull();

    renderRoute(() => <RoomScreen conversation={conversation!} />, {
      path: "/messenger/hyunwoo",
    });
    const input = screen.getByRole("textbox", { name: "메시지 입력" });
    fireEvent.change(input, { target: { value: "안녕하세" } });
    expect(
      await screen.findByRole("button", { name: "메시지 보내기" }),
    ).toBeEnabled();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getAllByRole("article")).toHaveLength(3);

    // Safari는 compositionend 뒤에 isComposing 없이 keyCode 229인 Enter를 보낸다.
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(screen.getAllByRole("article")).toHaveLength(3);

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(
        screen.getAllByRole("article", { name: "내 메시지" }).at(-1),
      ).toHaveTextContent("안녕하세"),
    );
  });

  it("넓은 화면의 대화 상세 패널을 접고 다시 펼친다", async () => {
    const conversation = await loadConversation("hyunwoo");
    expect(conversation).not.toBeNull();

    const { user } = renderRoute(
      () => <ControlledRoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );

    const closeButton = screen.getByRole("button", { name: "채팅 정보 닫기" });
    expect(closeButton).toHaveAttribute("aria-pressed", "true");

    await user.click(closeButton);
    const openButton = screen.getByRole("button", {
      name: "채팅 정보 열기",
      pressed: false,
    });
    expect(openButton).toHaveAttribute("aria-pressed", "false");

    await user.click(openButton);
    expect(
      screen.getByRole("button", { name: "채팅 정보 닫기" }),
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
      name: "이현우 채팅",
    });
    await user.click(
      screen.getAllByRole("button", { name: "채팅 정보 열기" })[0],
    );
    expect(conversationRegion).toHaveClass("hidden", "xl:flex");

    await user.click(screen.getByRole("button", { name: "채팅으로 돌아가기" }));
    expect(conversationRegion).toHaveClass("flex");
  });
});

describe("RoomScreen 멘션", () => {
  async function renderGroupRoom() {
    const conversation = await loadConversation("student-council");
    const view = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/student-council" },
    );
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "메시지 입력",
    });
    return { ...view, input };
  }

  function optionNames() {
    return within(screen.getByRole("listbox", { name: "멘션할 사람" }))
      .getAllByRole("option")
      .map((option) => option.textContent);
  }

  it("@를 치면 입력창 위에 후보를 띄우고, 이어 친 글자로 거르며, 고른 멘션을 보낸다", async () => {
    const sendSpy = vi.spyOn(mutations, "sendMessage");
    const { user, input } = await renderGroupRoom();

    await user.type(input, "회의 @");
    // 나는 후보에 없다. 맨 위는 대화 전체다.
    expect(optionNames()).toEqual(["모든 사람", "박서현", "최민준", "윤지우"]);
    expect(input).toHaveFocus();

    await user.type(input, "서");
    expect(optionNames()).toEqual(["박서현"]);
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      within(screen.getByRole("listbox")).getByRole("option").id,
    );

    // 목록이 열려 있는 동안의 Enter는 보내지 않고 고른다.
    await user.keyboard("{Enter}");
    expect(sendSpy).not.toHaveBeenCalled();
    expect(input).toHaveValue(`회의 ${mentionDisplayText("박서현", 1)} `);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.type(input, "봐 주세요{Enter}");
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "회의 [@박서현](m:1) 봐 주세요",
        mentionPubIds: ["seo-24"],
      }),
      expect.anything(),
    );
    expect(
      await screen.findByRole("link", { name: "@박서현" }),
    ).toHaveAttribute("href", "/profile/seo-24");
    sendSpy.mockRestore();
  });

  it("@모든 사람을 고르면 한 글자만 지워도 멘션 전체를 지운다", async () => {
    const { user, input } = await renderGroupRoom();

    await user.type(input, "@");
    await user.click(screen.getByRole("option", { name: "모든 사람" }));
    const mention = mentionDisplayText("모든 사람", 0);
    expect(input).toHaveValue(`${mention} `);
    expect(input).toHaveFocus();

    // 이름 가운데에 캐럿을 두고 한 글자만 지운다.
    input.setSelectionRange(4, 4);
    const deletion = new InputEvent("beforeinput", {
      inputType: "deleteContentBackward",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, deletion);
    expect(deletion.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(input).toHaveValue(" "));
  });

  it("조합 중이거나 지우기로 오지 않은 삭제도 멘션에 닿으면 멘션 전체를 지운다", async () => {
    const { user, input } = await renderGroupRoom();

    await user.type(input, "@서");
    await user.keyboard("{Enter}");
    const mention = mentionDisplayText("박서현", 1);
    expect(input).toHaveValue(`${mention} `);

    // 모바일 키보드와 한글 IME는 Backspace를 조합 글자 바꾸기로 보내 `beforeinput`에서 막지 못한다.
    // 브라우저가 이름의 끝 글자를 지운 뒤에 넓힌다.
    fireEvent.compositionStart(input);
    const caret = mention.length - 1;
    fireEvent.input(input, {
      target: {
        value: `${mention.slice(0, -1)} `,
        selectionStart: caret,
        selectionEnd: caret,
      },
    });
    await vi.waitFor(() => expect(input).toHaveValue(" "));
  });

  it("고른 멘션만 입력창에서 색을 입히고, 손으로 친 같은 글자는 그대로 둔다", async () => {
    const { user, input } = await renderGroupRoom();
    // 입력창과 같은 칸에 겹친 뒤판.
    const highlighted = () =>
      Array.from(
        input.parentElement!.querySelectorAll(".text-primary"),
        (node) => node.textContent?.replace(/[\u2060-\u2064]/g, ""),
      );

    await user.type(input, "@박서현 ");
    expect(highlighted()).toEqual([]);
    expect(input).not.toHaveClass("text-transparent");

    await user.type(input, "@최");
    await user.keyboard("{Enter}");
    expect(highlighted()).toEqual(["@최민준"]);
    expect(input).toHaveClass("text-transparent");
  });

  it("공백을 치거나 Esc를 누르면 목록을 닫고 친 글자는 그대로 둔다", async () => {
    const { user, input } = await renderGroupRoom();

    await user.type(input, "@최");
    expect(optionNames()).toEqual(["최민준"]);
    await user.type(input, " ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("@최 ");

    await user.type(input, "@");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("@최 @");

    // 맞는 후보가 없어도 닫는다.
    await user.type(input, "{Backspace}@없는사람");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("한글을 조합하는 동안에는 맞는 후보가 잠깐 없어도 닫지 않고, 확정하면 다시 거른다", async () => {
    const { user, input } = await renderGroupRoom();
    // React가 바뀐 값을 알아채도록 prototype의 setter로 넣고 캐럿을 그 뒤에 둔다.
    const composeTo = (value: string) => {
      Reflect.set(HTMLTextAreaElement.prototype, "value", value, input);
      input.setSelectionRange(value.length, value.length);
      fireEvent.input(input);
    };

    await user.type(input, "@");
    fireEvent.compositionStart(input);
    composeTo("@ㅊ");
    expect(optionNames()).toEqual(["최민준"]);
    // `최`를 치는 도중의 `초`는 어떤 이름과도 맞지 않는다.
    composeTo("@초");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    composeTo("@최");
    expect(optionNames()).toEqual(["최민준"]);
    fireEvent.compositionEnd(input);
    expect(optionNames()).toEqual(["최민준"]);
  });

  it("@만 치고 아무것도 고르지 않았으면 Enter로 평소처럼 보낸다", async () => {
    const sendSpy = vi.spyOn(mutations, "sendMessage");
    const { user, input } = await renderGroupRoom();

    await user.type(input, "연락은 abc@");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ body: "연락은 abc@", mentionPubIds: [] }),
      expect.anything(),
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    sendSpy.mockRestore();
  });

  it("1:1 대화에서는 @를 쳐도 후보를 띄우지 않는다", async () => {
    const conversation = await loadConversation("hyunwoo");
    const { user } = renderRoute(
      () => <RoomScreen conversation={conversation!} />,
      { path: "/messenger/hyunwoo" },
    );

    await user.type(screen.getByRole("textbox", { name: "메시지 입력" }), "@");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
