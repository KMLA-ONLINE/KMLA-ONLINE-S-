import { describe, expect, it, vi } from "vitest";

import { PageHeader } from "~/features/app-shell/components/page-header";
import { ScrollContainerContext } from "~/shared/lib/scroll-container";
import { renderRoute, screen } from "../../../router";

function renderHeader() {
  const scroller = document.createElement("main");
  const scrollTo = vi.spyOn(scroller, "scrollTo");
  const onAction = vi.fn();

  const view = renderRoute(() => (
    <ScrollContainerContext value={{ current: scroller }}>
      <PageHeader
        title="KMLA Online"
        actions={
          <button type="button" onClick={onAction}>
            검색
          </button>
        }
      />
    </ScrollContainerContext>
  ));

  return { ...view, scrollTo, onAction };
}

describe("PageHeader", () => {
  it("scrolls the page to the top when the title is tapped", async () => {
    const { user, scrollTo } = renderHeader();

    await user.click(screen.getByRole("heading", { name: "KMLA Online" }));

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });

  it("leaves header buttons to their own action", async () => {
    const { user, scrollTo, onAction } = renderHeader();

    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(onAction).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
