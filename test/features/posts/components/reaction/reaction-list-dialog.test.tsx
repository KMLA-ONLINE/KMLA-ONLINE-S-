import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReactionListDialog } from "~/features/posts/components/reaction/reaction-list-dialog";
import type { PostReactor } from "~/features/posts/model/types";
import { renderRoute, screen, within } from "../../../../router";

const identified = (over: Partial<PostReactor> = {}): PostReactor => ({
  reaction: "like",
  reactor_pub_id: "hanbyeol-25",
  reactor_name: "이한별",
  reactor_avatar_path: null,
  reactor_avatar_url: null,
  reacted_at: "2026-08-13T02:00:00Z",
  ...over,
});

function renderDialog(reactors: PostReactor[], loading = false) {
  return renderRoute(() => (
    <ReactionListDialog
      open
      onOpenChange={vi.fn()}
      reactors={reactors}
      loading={loading}
    />
  ));
}

describe("ReactionListDialog", () => {
  it("links an identified reactor to their profile", () => {
    renderDialog([identified()]);

    expect(screen.getByRole("link", { name: /이한별/ })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25",
    );
  });

  it("counts every reactor as an individual row", () => {
    renderDialog([
      identified(),
      identified({
        reaction: "love",
        reactor_pub_id: "saebyeok-24",
        reactor_name: "박새벽",
      }),
    ]);

    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(
      within(screen.getByRole("tablist")).getByRole("tab", { name: "전체 2" }),
    ).toBeInTheDocument();
  });

  it("keeps a withdrawn reactor in the total without linking a profile", () => {
    renderDialog([
      identified({
        reactor_pub_id: null,
        reactor_name: null,
        reactor_avatar_path: null,
        reactor_avatar_url: null,
      }),
    ]);

    expect(screen.getByText("탈퇴한 사용자")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("tablist")).getByRole("tab", { name: "전체 1" }),
    ).toBeInTheDocument();
  });

  it("filters the list to one reaction kind", async () => {
    const { user } = renderDialog([
      identified(),
      identified({
        reaction: "love",
        reactor_pub_id: "saebyeok-24",
        reactor_name: "박새벽",
      }),
    ]);

    await user.click(screen.getByRole("tab", { name: /하트/ }));

    expect(screen.getByText("박새벽")).toBeInTheDocument();
    expect(screen.queryByText("이한별")).not.toBeInTheDocument();
  });

  it("waits for the list instead of claiming there are none", () => {
    renderDialog([], true);
    expect(screen.queryByText("아직 반응이 없습니다")).not.toBeInTheDocument();
  });

  describe("bottom sheet", () => {
    afterEach(() => vi.restoreAllMocks());

    function showSheet(sheet: boolean) {
      vi.spyOn(window, "matchMedia").mockImplementation(
        (query) =>
          ({
            matches: query.includes("max-width: 1024px") && sheet,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      );
      const onOpenChange = vi.fn();
      renderRoute(() => (
        <ReactionListDialog
          open
          onOpenChange={onOpenChange}
          reactors={[identified()]}
        />
      ));
      return onOpenChange;
    }

    function pullList(distance: number) {
      const list = screen.getByTestId("reaction-list-scroll");
      fireEvent.touchStart(list, {
        touches: [{ identifier: 1, clientX: 20, clientY: 20 }],
      });
      fireEvent.touchMove(list, {
        touches: [{ identifier: 1, clientX: 20, clientY: 20 + distance }],
      });
      fireEvent.touchEnd(list);
    }

    it("closes when the list is pulled down from the top", () => {
      const onOpenChange = showSheet(true);
      pullList(120);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("stays open after a short pull", () => {
      const onOpenChange = showSheet(true);
      pullList(40);
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("keeps the pull gesture off outside the sheet viewport", () => {
      const onOpenChange = showSheet(false);
      pullList(120);
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("reaction-sheet-handle"),
      ).not.toBeInTheDocument();
    });
  });
});
