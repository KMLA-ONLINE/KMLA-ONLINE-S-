import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { patchPostEngagement } from "~/features/posts/data/cache";
import type { PostEngagement } from "~/features/posts/data/cache";
import { usePostEngagement } from "~/features/posts/hooks/use-post-engagement";

const server: PostEngagement = {
  comment_count: 1,
  reaction_count: 2,
  top_reactions: ["like"],
  my_reaction: null,
};

describe("usePostEngagement", () => {
  it("updates every observer of one post without touching another post", async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => ({
        first: usePostEngagement("post-a", server),
        second: usePostEngagement("post-a", server),
        other: usePostEngagement("post-b", server),
      }),
      { wrapper },
    );

    act(() => patchPostEngagement(queryClient, "post-a", { comment_count: 4 }));

    await waitFor(() => expect(result.current.first.comment_count).toBe(4));
    expect(result.current.second.comment_count).toBe(4);
    expect(result.current.other.comment_count).toBe(1);
  });
});
