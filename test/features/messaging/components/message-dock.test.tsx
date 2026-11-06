import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageDock } from "~/features/messaging/components/message-dock";
import { clearRoomDrafts } from "~/features/messaging/hooks/room-drafts";
import { renderRoute, screen, within } from "../../../router";
import { resetFakeMessaging } from "../fake-api";

vi.mock("~/features/messaging/data/queries", () => import("../fake-api"));
vi.mock("~/features/messaging/data/mutations", () => import("../fake-api"));
vi.mock("~/features/messaging/data/subscriptions", () => ({
  connectToTypingSignals: () => ({
    send: () => false,
    disconnect: () => undefined,
  }),
}));
// jsdom에는 포인터가 없다. 컴퓨터로 두어 Enter가 보내기가 되게 한다.
vi.mock("~/shared/lib/desktop-pointer", () => ({
  hasDesktopPointer: () => true,
}));
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

/** 메시지 독이 보이는 폭(1024px 이상)인지. 테스트마다 넓은 화면에서 시작한다. */
let wideViewport = true;

beforeEach(() => {
  wideViewport = true;
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query === "(min-width: 64rem)" && wideViewport,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  resetFakeMessaging();
  clearRoomDrafts();
});

const routes = [
  { path: "/messenger", Component: () => <p>메신저 목록</p> },
  { path: "/messenger/:roomId", Component: () => <p>열린 대화</p> },
];

/** 셸처럼 독을 숨겼다 다시 보이게 할 수 있는 틀. */
function DockHarness() {
  const [hidden, setHidden] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setHidden((value) => !value)}>
        숨김 전환
      </button>
      <MessageDock hidden={hidden} />
    </>
  );
}

describe("MessageDock", () => {
  it("알약 버튼에 안 읽은 수를 보이고, 누르면 대화 목록 패널을 펼친다", async () => {
    const { user } = renderRoute(() => <MessageDock />, { routes });

    const pill = await screen.findByRole("button", {
      name: "메시지, 읽지 않은 메시지 4개",
    });
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("region", { name: "메시지 독" }),
    ).not.toBeInTheDocument();

    await user.click(pill);

    const panel = await screen.findByRole("region", { name: "메시지 독" });
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(
      await within(panel).findByRole("button", { name: /학생회 기획부/ }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("searchbox")).toHaveFocus();
    // 펼치면 바가 패널의 머리가 되어 한 상자다. 크게 열기는 그 머리줄에 있다.
    const dock = screen.getByTestId("message-dock");
    expect(dock).toContainElement(pill);
    expect(dock).toContainElement(panel);
    expect(
      within(dock).getByRole("link", { name: "메신저에서 크게 열기" }),
    ).toHaveAttribute("href", "/messenger");
    expect(
      within(dock).queryByRole("button", { name: "메시지 독 닫기" }),
    ).not.toBeInTheDocument();

    await user.type(within(panel).getByRole("searchbox"), "현우");
    expect(
      within(panel).getByRole("button", { name: /이현우/ }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: /학생회 기획부/ }),
    ).not.toBeInTheDocument();
  });

  it("대화를 고르면 같은 자리에 미니 대화방이 열리고 Enter로 보낸다", async () => {
    const { user } = renderRoute(() => <MessageDock />, { routes });

    await user.click(await screen.findByRole("button", { name: /메시지/ }));
    const panel = await screen.findByRole("region", { name: "메시지 독" });
    await user.click(
      await within(panel).findByRole("button", { name: /학생회 기획부/ }),
    );

    expect(
      await within(panel).findByRole("heading", { name: "학생회 기획부" }),
    ).toBeInTheDocument();
    expect(
      await within(panel).findByText("내일 점심시간에 최종 확인할게요!"),
    ).toBeInTheDocument();
    // 목록은 사라지고 미니 대화방이 그 자리를 쓴다.
    expect(within(panel).queryByRole("searchbox")).not.toBeInTheDocument();
    expect(
      within(panel).getByRole("link", { name: "메신저에서 크게 열기" }),
    ).toHaveAttribute("href", "/messenger/student-council");
    // 미니 대화방이 열린 동안에는 대화방 머리가 바를 대신한다.
    expect(
      screen.queryByRole("button", { name: /^메시지(,|$)/ }),
    ).not.toBeInTheDocument();

    const input = within(panel).getByRole("textbox", { name: "메시지 입력" });
    expect(input).toHaveFocus();
    await user.type(input, "안녕하세요{Enter}");
    expect(await within(panel).findByText("안녕하세요")).toBeInTheDocument();
    expect(input).toHaveValue("");

    await user.click(within(panel).getByRole("button", { name: "채팅 목록" }));
    expect(
      await within(panel).findByRole("button", { name: /학생회 기획부/ }),
    ).toBeInTheDocument();
    // 열었던 대화방은 읽은 것으로 쳐 바의 안 읽은 수에서 빠진다.
    expect(
      await screen.findByRole("button", {
        name: "메시지, 읽지 않은 메시지 1개",
      }),
    ).toBeInTheDocument();
  });

  it("미니 대화방에서 사진과 파일을 보낸다", async () => {
    const { user } = renderRoute(() => <MessageDock />, { routes });

    await user.click(await screen.findByRole("button", { name: /메시지/ }));
    const panel = await screen.findByRole("region", { name: "메시지 독" });
    await user.click(
      await within(panel).findByRole("button", { name: /이현우/ }),
    );
    await within(panel).findByRole("heading", { name: "이현우" });

    expect(
      within(panel).getByRole("button", { name: "사진 보내기" }),
    ).toBeInTheDocument();
    await user.click(
      within(panel).getByRole("button", { name: "파일 보내기" }),
    );
    // 숨긴 파일 입력은 버튼이 대신 연다. 사진 입력이 앞, 파일 입력이 뒤다.
    const fileInput =
      panel.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
    await user.upload(
      fileInput,
      new File(["hello"], "회의록.pdf", { type: "application/pdf" }),
    );

    expect(
      await within(panel).findByRole("link", { name: "내려받기: 회의록.pdf" }),
    ).toHaveAttribute("href", expect.stringContaining("download=회의록.pdf"));
  });

  it("독을 숨겼다 다시 보이면 열어 둔 미니 대화방으로 돌아온다", async () => {
    const { user } = renderRoute(DockHarness, { routes });

    await user.click(await screen.findByRole("button", { name: /메시지/ }));
    const panel = await screen.findByRole("region", { name: "메시지 독" });
    await user.click(
      await within(panel).findByRole("button", { name: /학생회 기획부/ }),
    );
    await within(panel).findByRole("heading", { name: "학생회 기획부" });

    await user.click(screen.getByRole("button", { name: "숨김 전환" }));
    expect(
      screen.queryByRole("button", { name: /메시지/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "메시지 독" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "숨김 전환" }));
    const reopened = await screen.findByRole("region", { name: "메시지 독" });
    expect(
      await within(reopened).findByRole("heading", { name: "학생회 기획부" }),
    ).toBeInTheDocument();
  });

  it("Esc로 패널을 접고 알약 버튼으로 포커스를 돌린다", async () => {
    const { user } = renderRoute(() => <MessageDock />, { routes });

    const pill = await screen.findByRole("button", { name: /메시지/ });
    await user.click(pill);
    await screen.findByRole("region", { name: "메시지 독" });

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("region", { name: "메시지 독" }),
    ).not.toBeInTheDocument();
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(pill).toHaveFocus();
  });

  it("1024px보다 좁으면 아무것도 그리지 않는다", () => {
    wideViewport = false;
    renderRoute(() => <MessageDock />, { routes });

    expect(
      screen.queryByRole("button", { name: /메시지/ }),
    ).not.toBeInTheDocument();
  });
});
