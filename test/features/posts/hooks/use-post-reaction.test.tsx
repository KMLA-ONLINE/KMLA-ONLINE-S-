import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { setPostReaction } = vi.hoisted(() => ({
  setPostReaction: vi.fn(),
}));

vi.mock("~/features/posts/data/mutations", () => ({ setPostReaction }));
vi.mock("~/features/posts/data/queries", () => ({
  listPostReactors: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { usePostReaction } from "~/features/posts/hooks/use-post-reaction";
import type { ReactionSummary } from "~/features/posts/model/types";

const initial: ReactionSummary = {
  reaction_count: 3,
  top_reactions: ["haha"],
  my_reaction: null,
};

describe("usePostReaction", () => {
  it("shares the optimistic reaction and rolls every observer back on failure", async () => {
    let reject!: (reason: Error) => void;
    setPostReaction.mockImplementation(
      () =>
        new Promise((_, rejectRequest: (reason: Error) => void) => {
          reject = rejectRequest;
        }),
    );
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => ({
        first: usePostReaction("post-id", initial),
        second: usePostReaction("post-id", initial),
      }),
      { wrapper },
    );

    act(() => result.current.first.select("love"));

    await waitFor(() => {
      expect(result.current.first.summary).toMatchObject({
        reaction_count: 4,
        my_reaction: "love",
      });
    });
    expect(result.current.second.summary).toMatchObject({
      reaction_count: 4,
      my_reaction: "love",
    });
    expect(result.current.first.summary.top_reactions).toEqual(["haha"]);

    act(() => reject(new Error("failed")));

    await waitFor(() => {
      expect(result.current.first.summary).toMatchObject(initial);
      expect(result.current.second.summary).toMatchObject(initial);
    });
  });
});
