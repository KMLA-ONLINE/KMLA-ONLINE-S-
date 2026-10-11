import { screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { Link } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { PostLeaveGuard } from "~/features/posts/components/editor/post-leave-guard";
import { renderRoute } from "../../../../router";

function Editor({
  dirty,
  saving = false,
  discard,
}: {
  dirty: boolean;
  saving?: boolean;
  discard: () => Promise<void>;
}) {
  const disposedRef = useRef(false);
  return (
    <>
      <Link to="/away">나가기 링크</Link>
      <PostLeaveGuard
        dirty={dirty}
        saving={saving}
        mode="create"
        disposedRef={disposedRef}
        discard={discard}
      />
    </>
  );
}

function renderEditor(props: Parameters<typeof Editor>[0]) {
  return renderRoute(() => <Editor {...props} />, {
    routes: [{ path: "/away", Component: () => <p>떠난 화면</p> }],
  });
}

describe("PostLeaveGuard", () => {
  it("does not block navigation while nothing is dirty", async () => {
    const { user } = renderEditor({ dirty: false, discard: vi.fn() });

    await user.click(screen.getByRole("link", { name: "나가기 링크" }));

    expect(await screen.findByText("떠난 화면")).toBeInTheDocument();
  });

  it("does not block the navigation that follows a save", async () => {
    const { user } = renderEditor({
      dirty: true,
      saving: true,
      discard: vi.fn(),
    });

    await user.click(screen.getByRole("link", { name: "나가기 링크" }));

    expect(await screen.findByText("떠난 화면")).toBeInTheDocument();
  });

  it("asks before leaving a dirty draft and stays when cancelled", async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const { user } = renderEditor({ dirty: true, discard });

    await user.click(screen.getByRole("link", { name: "나가기 링크" }));
    expect(await screen.findByText("작성 중인 게시물")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() =>
      expect(screen.queryByText("작성 중인 게시물")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("떠난 화면")).not.toBeInTheDocument();
    expect(discard).not.toHaveBeenCalled();
  });

  it("discards the draft uploads and then proceeds when confirmed", async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const { user } = renderEditor({ dirty: true, discard });

    await user.click(screen.getByRole("link", { name: "나가기 링크" }));
    await user.click(await screen.findByRole("button", { name: "나가기" }));

    expect(await screen.findByText("떠난 화면")).toBeInTheDocument();
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("still proceeds when discarding the uploads fails", async () => {
    const discard = vi.fn().mockRejectedValue(new Error("cleanup failed"));
    const { user } = renderEditor({ dirty: true, discard });

    await user.click(screen.getByRole("link", { name: "나가기 링크" }));
    await user.click(await screen.findByRole("button", { name: "나가기" }));

    expect(await screen.findByText("떠난 화면")).toBeInTheDocument();
  });
});
