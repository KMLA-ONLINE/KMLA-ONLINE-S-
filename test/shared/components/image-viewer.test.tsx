import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageViewer } from "~/shared/components/image-viewer";
import { renderRoute } from "../../router";

const images = ["a", "b", "c"].map((id) => ({
  id,
  src: `https://example.com/${id}.webp`,
  downloadSrc: `https://example.com/${id}.webp?download=${id}.webp`,
  name: `${id}.webp`,
}));

function renderViewer(openImageId: string | null) {
  const onClose = vi.fn();
  const view = renderRoute(() => (
    <ImageViewer images={images} openImageId={openImageId} onClose={onClose} />
  ));
  return { ...view, onClose };
}

// 뷰어는 방향키를 `document`의 capture 단계에서 듣는다. 실제 키 이벤트처럼 포커스가
// 있는 요소에서 쏘서, 그 경로를 거치는지까지 함께 확인한다.
const pressArrow = (key: "ArrowLeft" | "ArrowRight") =>
  fireEvent.keyDown(document.body, { key });

describe("ImageViewer", () => {
  it("renders nothing while closed", () => {
    renderViewer(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on the requested image", () => {
    renderViewer("b");
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("pages with the arrow keys and stops at both ends", () => {
    renderViewer("a");

    pressArrow("ArrowLeft");
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    pressArrow("ArrowRight");
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    pressArrow("ArrowRight");
    pressArrow("ArrowRight");
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });

  it("hides the counter when there is only one image", () => {
    const single = [images[0]];
    renderRoute(() => (
      <ImageViewer images={single} openImageId="a" onClose={vi.fn()} />
    ));

    expect(screen.queryByText(/\/ 1/)).not.toBeInTheDocument();
  });

  it("saves through the attachment URL rather than the display one", () => {
    renderViewer("b");

    expect(screen.getByRole("link", { name: "다운로드" })).toHaveAttribute(
      "href",
      "https://example.com/b.webp?download=b.webp",
    );
  });

  it("closes on the close button", async () => {
    const { user, onClose } = renderViewer("a");

    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalled();
  });
});
