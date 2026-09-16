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

function tap(image: HTMLElement, pointerType = "touch") {
  fireEvent.pointerDown(image, {
    pointerId: 1,
    pointerType,
    clientX: 200,
    clientY: 300,
  });
  fireEvent.pointerUp(image, {
    pointerId: 1,
    pointerType,
    clientX: 200,
    clientY: 300,
  });
  fireEvent.click(image, { clientX: 200, clientY: 300 });
}

function doubleTap(image: HTMLElement, pointerType = "touch") {
  tap(image, pointerType);
  tap(image, pointerType);
}

/** 원본 프리로드를 가로채, 언제 끝난 것으로 칠지 테스트가 정하게 한다. */
function stubImagePreloading() {
  const preloaded: { onload: (() => void) | null }[] = [];

  class ImagePreloader {
    crossOrigin = "";
    onload: (() => void) | null = null;

    set src(_value: string) {
      preloaded.push(this);
    }
  }

  vi.stubGlobal("Image", ImagePreloader);

  return {
    finishAll: () => act(() => preloaded.forEach((image) => image.onload?.())),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it("shows a thumbnail until the original image finishes loading", () => {
    const preloading = stubImagePreloading();
    renderRoute(() => (
      <ImageViewer
        images={[
          { ...images[0], thumbSrc: "https://example.com/a-thumb.webp" },
        ]}
        openImageId="a"
        onClose={vi.fn()}
      />
    ));

    const image = screen.getByAltText("a.webp");
    expect(image).toHaveAttribute("src", "https://example.com/a-thumb.webp");

    preloading.finishAll();
    expect(image).toHaveAttribute("src", "https://example.com/a.webp");
  });

  it("keeps the original after paging away from a slide and back", () => {
    const preloading = stubImagePreloading();
    renderRoute(() => (
      <ImageViewer
        images={images.map((image) => ({
          ...image,
          thumbSrc: `https://example.com/${image.id}-thumb.webp`,
        }))}
        openImageId="a"
        onClose={vi.fn()}
      />
    ));

    preloading.finishAll();
    expect(screen.getByAltText("a.webp")).toHaveAttribute(
      "src",
      "https://example.com/a.webp",
    );

    // 두 칸 넘기면 첫 슬라이드는 디코딩 창 밖으로 나가 언마운트된다. 돌아왔을 때 다시
    // 축소본부터 그리면, 이미 받아 둔 원본을 두고 저해상도를 한 번 더 보여 주는 셈이다.
    pressArrow("ArrowRight");
    pressArrow("ArrowRight");
    expect(screen.queryByAltText("a.webp")).not.toBeInTheDocument();

    pressArrow("ArrowLeft");
    pressArrow("ArrowLeft");
    expect(screen.getByAltText("a.webp")).toHaveAttribute(
      "src",
      "https://example.com/a.webp",
    );
  });

  it("closes on the close button", async () => {
    const { user, onClose } = renderViewer("a");

    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders a desktop filmstrip and a mobile overlay filmstrip", () => {
    renderViewer("a");

    expect(screen.getByTestId("image-viewer-filmstrip")).toHaveClass(
      "hidden",
      "sm:block",
    );
    expect(screen.getByTestId("image-viewer-mobile-filmstrip")).toHaveClass(
      "sm:hidden",
      "absolute",
      "bottom-0",
    );
  });

  it("toggles the mobile chrome and filmstrip without changing the image viewport layout", () => {
    vi.useFakeTimers();
    renderViewer("a");
    const { image } = getGestureElements();
    const header = screen.getByTestId("image-viewer-header");
    const filmstrip = screen.getByTestId("image-viewer-mobile-filmstrip");

    tap(image);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(header).toHaveClass(
      "absolute",
      "pointer-events-none",
      "opacity-0",
      "sm:static",
    );
    expect(header).not.toHaveClass("hidden");
    expect(filmstrip).toHaveClass("pointer-events-none", "opacity-0");

    tap(image);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(header).toHaveClass("flex", "opacity-100");
    expect(header).not.toHaveClass("pointer-events-none", "hidden");
    expect(filmstrip).toHaveClass("opacity-100");
    expect(filmstrip).not.toHaveClass("pointer-events-none");
  });

  it("does not shift slides for 10px of touch jitter", () => {
    renderViewer("a");
    const { viewport } = getGestureElements();
    const track = screen.getByTestId("image-viewer-track");

    fireEvent.pointerDown(viewport, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 300,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 210,
      clientY: 300,
    });

    expect(track).toHaveStyle({
      transform: "translateX(calc(0% + 0px))",
    });
  });

  it("changes image after an intentional horizontal swipe", () => {
    renderViewer("a");
    const { viewport } = getGestureElements();

    fireEvent.pointerDown(viewport, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 300,
    });
    fireEvent.pointerUp(viewport, { pointerId: 1, pointerType: "touch" });

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("snaps the track back when a swipe grabbed mid-animation turns vertical", () => {
    renderViewer("a");
    const { viewport } = getGestureElements();
    const track = screen.getByTestId("image-viewer-track");
    // 슬라이드 애니메이션이 도는 중에 손을 댄 상황을 만든다. 정지 상태에서 잡으면 되돌릴
    // offset이 애초에 0이라 이 경로가 드러나지 않는다. jsdom에는 DOMMatrix가 없으므로
    // 트랙이 정지 위치에서 150px 떨어진 지점에 그려져 있다고 알려 준다.
    class StubMatrix {
      m41 = -150;
    }
    vi.stubGlobal("DOMMatrix", StubMatrix);
    const computedStyle = window.getComputedStyle.bind(window);
    const grabbedTransform = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element, pseudo) =>
        element === track
          ? ({
              transform: "matrix(1, 0, 0, 1, -150, 0)",
            } as CSSStyleDeclaration)
          : computedStyle(element, pseudo),
      );

    fireEvent.pointerDown(viewport, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 300,
    });
    // 뷰어가 트랙 위치를 읽는 것은 잡는 순간뿐이다. 이후 단언은 실제 스타일로 확인한다.
    grabbedTransform.mockRestore();
    expect(track).toHaveStyle({ transform: "translateX(calc(0% + -150px))" });

    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 202,
      clientY: 360,
    });
    fireEvent.pointerUp(viewport, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 202,
      clientY: 360,
    });

    expect(track).toHaveStyle({ transform: "translateX(calc(0% + 0px))" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("zooms on a tablet touch double tap and resets when the image changes", () => {
    vi.useFakeTimers();
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

  it("does not zoom from a mouse double click", () => {
    vi.useFakeTimers();
    renderViewer("a");
    const { image } = getGestureElements();

    doubleTap(image, "mouse");

    expect(image).toHaveStyle({
      transform: "translate3d(0px, 0px, 0) scale(1)",
    });
  });

  it("caps tablet pinch zoom at 4x and does not page while zoomed", () => {
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
