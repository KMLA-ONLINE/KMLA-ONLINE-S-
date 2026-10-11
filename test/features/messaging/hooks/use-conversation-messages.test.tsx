import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as mutations from "~/features/messaging/data/mutations";
import { loadConversation } from "~/features/messaging/data/queries";
import { useConversationMessages } from "~/features/messaging/hooks/use-conversation-messages";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

async function renderMessages() {
  const conversation = (await loadConversation("student-council"))!;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useConversationMessages(conversation), { wrapper });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useConversationMessages", () => {
  it("보낸 메시지를 먼저 붙이고 정본으로 확정한다", async () => {
    const { result } = await renderMessages();

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send("안녕", "m9");
    });

    expect(sent).toBe(true);
    // cache 알림은 다음 tick에 묶여 나간다.
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        body: "안녕",
        senderId: "viewer",
        replyToMessageId: "m9",
      }),
    );
  });

  it("전송이 실패하면 먼저 붙인 메시지를 거두고 false로 끝난다", async () => {
    vi.spyOn(mutations, "sendMessage").mockRejectedValue(new Error("offline"));
    const { result } = await renderMessages();
    const before = result.current.messages.length;

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send("안녕");
    });

    expect(sent).toBe(false);
    expect(result.current.messages).toHaveLength(before);
  });

  it("같은 반응을 다시 고르면 지우고, 실패하면 직전 반응으로 되돌린다", async () => {
    const { result } = await renderMessages();
    const target = () => result.current.messages.find(({ id }) => id === "m3")!;

    act(() => result.current.react(target(), "love"));
    await waitFor(() => expect(target().myReaction).toBe("love"));
    expect(target().reactions).toContainEqual({ reaction: "love", count: 1 });

    act(() => result.current.react(target(), "love"));
    await waitFor(() => expect(target().myReaction).toBeNull());

    vi.spyOn(mutations, "setMessageReaction").mockRejectedValue(
      new Error("offline"),
    );
    act(() => result.current.react(target(), "haha"));
    await waitFor(() => expect(target().myReaction).toBeNull());
    expect(target().reactions).toEqual([{ reaction: "like", count: 3 }]);
  });
});
