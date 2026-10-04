import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ImageViewer,
  type ViewerImage,
} from "~/shared/components/image-viewer";
import { renderRoute } from "../../router";

// 원본 decode 기억은 모듈 전역이라, 테스트마다 URL을 달리해 서로 새지 않게 한다.
let batch = 0;

function makeImages(
  count = 3,
  { thumbnails = false }: { thumbnails?: boolean } = {},
): ViewerImage[] {
  batch += 1;
  return ["a", "b", "c", "d"].slice(0, count).map((id) => ({
    id,
    src: `https://example.com/${batch}/${id}.webp`,
    thumbSrc: thumbnails
      ? `https://example.com/${batch}/${id}.thumb.webp`
      : undefined,
    downloadSrc: `https://example.com/${batch}/${id}.webp?download=${id}.webp`,
    name: `${id}.webp`,
    width: 300,
    height: 400,
  }));
}

function renderViewer(
  openImageId: string | null = "a",
  images: ViewerImage[] = makeImages(),
  { downloadAll = false }: { downloadAll?: boolean } = {},
) {
  const onClose = vi.fn();
  const view = renderRoute(() => (
    <ImageViewer
      images={images}
      openImageId={openImageId}
      downloadAll={downloadAll}
      onClose={onClose}
    />
  ));
  return { ...view, onClose, images };
}

const viewport = () => screen.getByTestId("image-viewer-viewport");
const frame = () => screen.getByTestId("image-viewer-frame");
const chrome = () => screen.getByTestId("image-viewer-chrome");
const counter = (text: string) => screen.getByText(text);
/** 움직임은 React를 거치지 않고 인라인 transform에 곧바로 쓰인다. 그 문자열을 그대로 본다. */
const transformOf = (element: HTMLElement) => element.style.transform;

type PointerType = "touch" | "mouse";
interface PointerInit {
  x: number;
  y: number;
  id?: number;
  type?: PointerType;
}

const pointerInit = ({ x, y, id = 1, type = "touch" }: PointerInit) => ({
  pointerId: id,
  pointerType: type,
  button: 0,
  clientX: x,
  clientY: y,
});

const down = (init: PointerInit) =>
  fireEvent.pointerDown(viewport(), pointerInit(init));
const move = (init: PointerInit) =>
  fireEvent.pointerMove(viewport(), pointerInit(init));
const up = (init: PointerInit) =>
  fireEvent.pointerUp(viewport(), pointerInit(init));

/** 한 점에서 다른 점으로 끈다. 처음 조금은 판정 문턱을 넘기는 데 쓴다. */
function drag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  type: PointerType = "touch",
) {
  down({ ...from, type });
  const dx = Math.sign(to.x - from.x) * 15;
  const dy = Math.sign(to.y - from.y) * 15;
  move({ x: from.x + dx, y: from.y + dy, type });
  move({ ...to, type });
  up({ ...to, type });
}

function tap(x = 200, y = 300, type: PointerType = "touch") {
  down({ x, y, type });
  up({ x, y, type });
}

beforeEach(() => {
  // jsdom은 레이아웃을 계산하지 않는다. 400×600 화면에 300×400 이미지가 가운데 놓인다.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
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
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.classList.remove("image-viewer-open");
});

describe("ImageViewer", () => {
  it("renders nothing while closed", () => {
    renderViewer(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides the document scrollbar only while open", () => {
    const { unmount } = renderViewer();
    expect(document.documentElement).toHaveClass("image-viewer-open");
    unmount();
    expect(document.documentElement).not.toHaveClass("image-viewer-open");
  });

  it("opens on the requested image", () => {
    renderViewer("b");
    expect(counter("2 / 3")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "b.webp" })).toBeInTheDocument();
  });

  it("sizes the image from the stored dimensions before it loads", () => {
    renderViewer();
    expect(frame()).toHaveStyle({ width: "300px", height: "400px" });
  });

  it("pages with the arrow keys and stops at both ends", () => {
    renderViewer();

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(counter("1 / 3")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(counter("3 / 3")).toBeInTheDocument();
    expect(transformOf(screen.getByTestId("image-viewer-track"))).toBe(
      "translate3d(-832px, 0, 0)",
    );
  });

  it("hides the counter and the filmstrip when there is only one image", () => {
    renderViewer("a", makeImages(1));
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("image-viewer-filmstrip"),
    ).not.toBeInTheDocument();
  });

  it("jumps to a filmstrip thumbnail", () => {
    renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "3번째 이미지" }));
    expect(counter("3 / 3")).toBeInTheDocument();
  });

  it("saves a single image through the attachment URL", () => {
    const { images } = renderViewer("a", makeImages(1));
    expect(screen.getByRole("link", { name: "다운로드" })).toHaveAttribute(
      "href",
      images[0].downloadSrc,
    );
  });

  it("saves only the current image unless the batch allows saving all", () => {
    const { images } = renderViewer("b");
    expect(screen.getByRole("link", { name: "다운로드" })).toHaveAttribute(
      "href",
      images[1].downloadSrc,
    );
  });

  it("offers the current image or every image when there are several", async () => {
    const { user, images } = renderViewer("b", makeImages(), {
      downloadAll: true,
    });

    await user.click(screen.getByRole("button", { name: "다운로드" }));
    // Base UI 메뉴는 한 틱 뒤에 열린다.
    expect(
      await screen.findByRole("menuitem", { name: "현재 사진 다운로드" }),
    ).toHaveAttribute("href", images[1].downloadSrc);

    // 실제로 붙이면 jsdom이 iframe 주소를 불러오려 든다. 무엇을 붙이려 했는지만 본다.
    const append = vi
      .spyOn(document.body, "append")
      .mockImplementation(() => undefined);
    await user.click(
      screen.getByRole("menuitem", { name: "모든 사진 다운로드 (3장)" }),
    );
    await vi.waitFor(
      () => {
        const sources = append.mock.calls.map(
          ([element]) => (element as HTMLIFrameElement).src,
        );
        expect(sources).toEqual(images.map((image) => image.downloadSrc));
      },
      { timeout: 2000 },
    );
  });

  it("closes on the close button", async () => {
    const { user, onClose } = renderViewer();
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe("progressive loading", () => {
    const original = () => screen.getByAltText("a.webp");

    it("shows the thumbnail until the original finishes decoding", async () => {
      let finishDecode: () => void = () => undefined;
      HTMLImageElement.prototype.decode = () =>
        new Promise<void>((resolve) => {
          finishDecode = resolve;
        });
      try {
        renderViewer("a", makeImages(3, { thumbnails: true }));
        expect(original()).not.toHaveAttribute("data-shown");

        fireEvent.load(original());
        expect(original()).not.toHaveAttribute("data-shown");

        await act(async () => {
          finishDecode();
          await Promise.resolve();
        });
        expect(original()).toHaveAttribute("data-shown");
      } finally {
        // jsdom에는 원래 없다.
        Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
      }
    });

    it("keeps the thumbnail when the original fails", () => {
      renderViewer("a", makeImages(3, { thumbnails: true }));
      fireEvent.error(original());
      expect(original()).not.toHaveAttribute("data-shown");
      expect(
        screen.queryByText("이미지를 불러오지 못했습니다"),
      ).not.toBeInTheDocument();
    });

    it("says so when there is nothing to show", () => {
      renderViewer();
      fireEvent.error(original());
      expect(
        screen.getByText("이미지를 불러오지 못했습니다"),
      ).toBeInTheDocument();
    });

    it("keeps the original after paging away from a slide and back", () => {
      renderViewer("a", makeImages(3, { thumbnails: true }));
      fireEvent.load(original());

      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(screen.queryByAltText("a.webp")).not.toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      expect(original()).toHaveAttribute("data-shown");
    });
  });

  describe("touch", () => {
    it("toggles the chrome on a tap without moving the image", () => {
      vi.useFakeTimers();
      renderViewer();
      const box = () => {
        const { left, top, width, height } = frame().style;
        return { left, top, width, height };
      };
      const before = box();

      tap();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(chrome()).toHaveAttribute("data-hidden");
      expect(box()).toEqual(before);

      tap();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(chrome()).not.toHaveAttribute("data-hidden");
    });

    it("enters fullscreen once with the chrome hidden and leaves it on close", () => {
      vi.useFakeTimers();
      const root = document.documentElement;
      let fullscreenElement: Element | null = null;
      const requestFullscreen = vi.fn(() => {
        fullscreenElement = root;
        return Promise.resolve();
      });
      const exitFullscreen = vi.fn(() => {
        fullscreenElement = null;
        return Promise.resolve();
      });
      Object.defineProperty(root, "requestFullscreen", {
        configurable: true,
        value: requestFullscreen,
      });
      Object.defineProperties(document, {
        fullscreenEnabled: { configurable: true, value: true },
        fullscreenElement: { configurable: true, get: () => fullscreenElement },
        exitFullscreen: { configurable: true, value: exitFullscreen },
      });

      try {
        const { unmount } = renderViewer();
        tap();
        act(() => {
          vi.advanceTimersByTime(300);
        });
        expect(requestFullscreen).toHaveBeenCalledWith({
          navigationUI: "hide",
        });

        // 조작부를 다시 보이고 숨겨도 전체화면은 그대로다.
        for (let i = 0; i < 2; i++) {
          tap();
          act(() => {
            vi.advanceTimersByTime(300);
          });
        }
        expect(chrome()).toHaveAttribute("data-hidden");
        expect(requestFullscreen).toHaveBeenCalledOnce();
        expect(exitFullscreen).not.toHaveBeenCalled();

        unmount();
        expect(exitFullscreen).toHaveBeenCalledOnce();
      } finally {
        // 테스트가 붙인 것만 걷어 낸다. jsdom에는 원래 없다.
        Reflect.deleteProperty(root, "requestFullscreen");
        for (const key of [
          "fullscreenEnabled",
          "fullscreenElement",
          "exitFullscreen",
        ]) {
          Reflect.deleteProperty(document, key);
        }
      }
    });

    it("does not page for small jitter", () => {
      renderViewer();
      down({ x: 200, y: 300 });
      move({ x: 208, y: 302 });
      up({ x: 208, y: 302 });
      expect(counter("1 / 3")).toBeInTheDocument();
    });

    it("pages after an intentional horizontal swipe", () => {
      // 시계를 멈춰 두면 속도가 0이라, 거리만으로 판정하는지 본다.
      vi.useFakeTimers();
      renderViewer();
      drag({ x: 300, y: 300 }, { x: 100, y: 300 });
      expect(counter("2 / 3")).toBeInTheDocument();
    });

    it("pages on a quick flick even when it is short", () => {
      vi.useFakeTimers();
      renderViewer();
      down({ x: 300, y: 300 });
      move({ x: 285, y: 300 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
      move({ x: 255, y: 300 });
      up({ x: 255, y: 300 });
      expect(counter("2 / 3")).toBeInTheDocument();
    });

    it("snaps back at the first image instead of paging", () => {
      // 시계를 멈춰 두면 속도가 0이라, 거리만으로 판정하는지 본다.
      vi.useFakeTimers();
      renderViewer();
      drag({ x: 100, y: 300 }, { x: 350, y: 300 });
      expect(counter("1 / 3")).toBeInTheDocument();
      expect(transformOf(screen.getByTestId("image-viewer-track"))).toBe(
        "translate3d(0px, 0, 0)",
      );
    });

    it("closes on a downward swipe and springs back on a short one", () => {
      // 시계를 멈춰 두면 속도가 0이라, 거리만으로 판정하는지 본다.
      vi.useFakeTimers();
      const { onClose } = renderViewer();
      const slide = () => screen.getByTestId("image-viewer-active-slide");

      drag({ x: 200, y: 300 }, { x: 200, y: 340 });
      expect(onClose).not.toHaveBeenCalled();
      expect(transformOf(slide())).toBe("");

      drag({ x: 200, y: 300 }, { x: 200, y: 460 });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("zooms on a double tap around the tapped point and resets on the next", () => {
      vi.useFakeTimers();
      renderViewer();

      tap(100, 200);
      tap(100, 200);
      expect(transformOf(frame())).toBe(
        "translate3d(100px, 100px, 0) scale(2)",
      );
      // 확대하면 조작부가 비켜 준다.
      expect(chrome()).toHaveAttribute("data-hidden");

      act(() => {
        vi.advanceTimersByTime(300);
      });
      tap(100, 200);
      tap(100, 200);
      expect(transformOf(frame())).toBe("translate3d(0px, 0px, 0) scale(1)");
    });

    it("pans a zoomed image instead of paging", () => {
      vi.useFakeTimers();
      renderViewer();
      tap();
      tap();

      drag({ x: 200, y: 300 }, { x: 150, y: 250 });
      expect(counter("1 / 3")).toBeInTheDocument();
      expect(transformOf(frame())).toBe(
        // 판정 문턱을 넘기는 데 쓴 15px은 따라가지 않는다.
        "translate3d(-35px, -35px, 0) scale(2)",
      );
    });

    it("caps a pinch at 5x and does not page while zoomed", () => {
      renderViewer();
      down({ id: 1, x: 150, y: 300 });
      down({ id: 2, x: 250, y: 300 });
      move({ id: 2, x: 1150, y: 300 });
      up({ id: 2, x: 1150, y: 300 });
      up({ id: 1, x: 150, y: 300 });

      expect(transformOf(frame())).toMatch(/scale\(5\)$/);
      expect(counter("1 / 3")).toBeInTheDocument();
    });

    it("resets the zoom when the image changes", () => {
      vi.useFakeTimers();
      renderViewer();
      tap();
      tap();
      expect(transformOf(frame())).toMatch(/scale\(2\)$/);

      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(counter("2 / 3")).toBeInTheDocument();
      expect(transformOf(frame())).not.toMatch(/scale\(2\)/);
      expect(screen.getByRole("button", { name: "축소" })).toBeDisabled();
    });
  });

  describe("mouse", () => {
    it("zooms on a click on the image and restores on the next", () => {
      renderViewer();
      tap(200, 300, "mouse");
      expect(transformOf(frame())).toBe("translate3d(0px, 0px, 0) scale(2)");
      expect(screen.getByRole("button", { name: "축소" })).toBeEnabled();

      tap(20, 20, "mouse");
      expect(transformOf(frame())).toBe("translate3d(0px, 0px, 0) scale(1)");
    });

    it("ignores a click on the backdrop at 1x", () => {
      renderViewer();
      tap(20, 20, "mouse");
      expect(transformOf(frame())).not.toMatch(/scale\(2\)/);
      expect(chrome()).not.toHaveAttribute("data-hidden");
    });

    it("drags a zoomed image without toggling the zoom", () => {
      renderViewer();
      tap(200, 300, "mouse");
      drag({ x: 200, y: 300 }, { x: 250, y: 350 }, "mouse");
      expect(transformOf(frame())).toBe("translate3d(50px, 50px, 0) scale(2)");
    });

    it("never swipes between images", () => {
      renderViewer();
      drag({ x: 300, y: 300 }, { x: 50, y: 300 }, "mouse");
      expect(counter("1 / 3")).toBeInTheDocument();
    });

    it("zooms with the wheel around the cursor", () => {
      renderViewer();
      fireEvent.wheel(viewport(), { deltaY: -100, clientX: 200, clientY: 300 });
      expect(transformOf(frame())).toMatch(/scale\(1\.22\d*\)$/);
    });

    it("zooms with the header buttons and the keyboard", async () => {
      const { user } = renderViewer();
      await user.click(screen.getByRole("button", { name: "확대" }));
      expect(transformOf(frame())).toMatch(/scale\(1\.5\)$/);

      fireEvent.keyDown(document.body, { key: "0" });
      expect(transformOf(frame())).toBe("translate3d(0px, 0px, 0) scale(1)");
      expect(screen.getByRole("button", { name: "축소" })).toBeDisabled();
    });
  });
});
