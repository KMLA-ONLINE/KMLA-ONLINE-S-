import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function stubMobileViewport() {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({ matches: query === "(max-width: 639px)" }) as MediaQueryList,
  );
}

function getGestureElements() {
  const image = screen.getByAltText("a.webp");
  const viewport = screen.getByTestId("image-viewer-viewport");

  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 400 },
    clientHeight: { configurable: true, value: 600 },
  });
  Object.defineProperties(image, {
    clientWidth: { configurable: true, value: 300 },
    clientHeight: { configurable: true, value: 400 },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: 600,
    top: 0,
    right: 400,
    bottom: 600,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  return { image, viewport };
}

function doubleTap(image: HTMLElement) {
  fireEvent.click(image, { clientX: 200, clientY: 300 });
  fireEvent.click(image, { clientX: 200, clientY: 300 });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ImageViewer", () => {
  it("renders nothing while closed", () => {
    renderViewer(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("image-viewer-open");
  });

  it("hides the document scrollbar only while open", () => {
    const view = renderViewer("a");
    expect(document.documentElement).toHaveClass("image-viewer-open");

    view.unmount();
    expect(document.documentElement).not.toHaveClass("image-viewer-open");
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

  it("keeps the filmstrip desktop-only", () => {
    renderViewer("a");

    expect(screen.getByTestId("image-viewer-filmstrip")).toHaveClass(
      "hidden",
      "sm:block",
    );
  });

  it("toggles the mobile chrome with a single image tap", () => {
    vi.useFakeTimers();
    stubMobileViewport();
    renderViewer("a");
    const { image } = getGestureElements();
    const header = screen.getByTestId("image-viewer-header");

    fireEvent.click(image);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(header).toHaveClass("hidden", "sm:flex");

    fireEvent.click(image);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(header).toHaveClass("flex");
    expect(header).not.toHaveClass("hidden");
  });

  it("zooms on a mobile double tap and resets when the image changes", () => {
    vi.useFakeTimers();
    stubMobileViewport();
    renderViewer("a");
    const { image } = getGestureElements();

    doubleTap(image);
    expect(image).toHaveStyle({
      transform: "translate3d(0px, 0px, 0) scale(2)",
    });

    pressArrow("ArrowRight");
    expect(screen.getByAltText("b.webp")).toHaveStyle({
      transform: "translate3d(0px, 0px, 0) scale(1)",
    });
  });

  it("caps mobile pinch zoom at 4x and does not page while zoomed", () => {
    stubMobileViewport();
    renderViewer("a");
    const { image, viewport } = getGestureElements();

    fireEvent.pointerDown(viewport, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 300,
    });
    fireEvent.pointerDown(viewport, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 250,
      clientY: 300,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 750,
      clientY: 300,
    });
    fireEvent.pointerUp(viewport, { pointerId: 2, pointerType: "touch" });
    fireEvent.pointerUp(viewport, { pointerId: 1, pointerType: "touch" });

    expect(image.style.transform).toContain("scale(4)");

    fireEvent.pointerDown(viewport, {
      pointerId: 3,
      pointerType: "touch",
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 3,
      pointerType: "touch",
      clientX: 50,
      clientY: 300,
    });
    fireEvent.pointerUp(viewport, { pointerId: 3, pointerType: "touch" });

    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });
});
