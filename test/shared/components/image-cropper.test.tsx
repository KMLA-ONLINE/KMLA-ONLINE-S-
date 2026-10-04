import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageCropper } from "~/shared/components/image-cropper";
import { cropImage } from "~/shared/lib/image/crop";
import type * as CropModule from "~/shared/lib/image/crop";

// 좌표 기하는 진짜를 쓰고 canvas만 대역으로 세운다 — jsdom에는 `createImageBitmap`도
// `canvas.toBlob`도 없지만, clamp 계약은 실제 `coverFit`으로 검증해야 의미가 있다.
vi.mock("~/shared/lib/image/crop", async (importOriginal) => ({
  ...(await importOriginal<typeof CropModule>()),
  cropImage: vi.fn(),
}));

const FRAME = 200;
const IMAGE = { width: 2000, height: 1000 };

// zoom 1에서 dispScale = 0.2, 표시 폭 400px, 프레임 200px → 좌우로 ±100px까지 움직인다.
const MAX_OFFSET_X = 100;
const CENTERED_LEFT = (FRAME - IMAGE.width * 0.2) / 2; // -100

function baseProps() {
  return {
    file: new File(["x"], "photo.jpg", { type: "image/jpeg" }),
    previewUrl: "blob:test/1",
    aspect: 1,
    maxOutputEdge: 512,
    onCancel: vi.fn(),
    onComplete: vi.fn(),
  };
}

/**
 * 미리보기 `<img>`를 찾는다.
 *
 * 이 이미지는 `alt=""`인 장식 요소라 접근성 트리에 없다 — 크롭 영역이 이름과 설명을 갖고 있고
 * 이미지 자체는 읽을 게 없으므로 그게 맞는 설계다. 그래서 role로 질의할 방법이 없다.
 */
function findPreviewImg(): HTMLImageElement | null {
  return screen.getByRole("application").querySelector("img");
}

/** 로드된 미리보기 이미지를 흉내 낸다. jsdom은 실제로 이미지를 가져오지 않는다. */
function loadPreview() {
  const img = findPreviewImg();
  if (!img) throw new Error("preview img not found");

  Object.defineProperty(img, "naturalWidth", {
    value: IMAGE.width,
    configurable: true,
  });
  Object.defineProperty(img, "naturalHeight", {
    value: IMAGE.height,
    configurable: true,
  });
  fireEvent.load(img);

  return img;
}

describe("ImageCropper", () => {
  beforeEach(() => {
    // jsdom은 레이아웃을 하지 않아 clientWidth/clientHeight가 언제나 0이다. 프레임 측정이
    // 0을 무시하도록 짜여 있으므로, 크기를 주지 않으면 영원히 준비되지 않는다.
    Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
      value: FRAME,
      configurable: true,
    });
    Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
      value: FRAME,
      configurable: true,
    });
  });

  it("이미지가 로드되기 전에는 적용할 수 없다", () => {
    render(<ImageCropper {...baseProps()} />);

    expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
    expect(screen.getByLabelText("이미지 불러오는 중")).toBeInTheDocument();
  });

  it("로드되면 프레임이 실제로 포커스를 받고 적용이 열린다", () => {
    render(<ImageCropper {...baseProps()} />);
    loadPreview();

    const frame = screen.getByRole("application");
    expect(frame).toHaveAttribute("tabindex", "0");

    // 다이얼로그의 포커스 트랩이 되돌려 놓지 않는지까지 확인한다 — 포커스가 가지 않으면
    // 방향키 조작이 존재하지 않는 것과 같다.
    frame.focus();
    expect(frame).toHaveFocus();

    expect(screen.getByRole("button", { name: "적용" })).toBeEnabled();
  });

  it("방향키로 이미지를 민다", () => {
    render(<ImageCropper {...baseProps()} />);
    const img = loadPreview();
    expect(img).toHaveStyle({ left: `${CENTERED_LEFT}px` });

    fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowRight" });

    // 드래그와 같은 방향 — 오른쪽 화살표는 이미지를 오른쪽으로 민다.
    expect(img).toHaveStyle({ left: `${CENTERED_LEFT + 16}px` });
  });

  it("Shift를 누르면 더 크게 움직이고, 한계를 넘지 않는다", () => {
    render(<ImageCropper {...baseProps()} />);
    const img = loadPreview();
    const frame = screen.getByRole("application");

    // 64px씩 세 번 = 192px이지만 한계는 100px이다.
    for (let i = 0; i < 3; i += 1) {
      fireEvent.keyDown(frame, { key: "ArrowRight", shiftKey: true });
    }

    expect(img).toHaveStyle({ left: `${CENTERED_LEFT + MAX_OFFSET_X}px` });
  });

  it("세로로 여유가 없으면 위아래로는 움직이지 않는다", () => {
    render(<ImageCropper {...baseProps()} />);
    const img = loadPreview();
    const { top } = img.style;

    fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowDown" });

    // 2000x1000 이미지를 정사각 프레임에 덮으면 세로는 딱 맞는다 → maxOffsetY = 0.
    expect(img).toHaveStyle({ top });
  });

  it("적용하면 잘린 파일을 넘긴다", async () => {
    const cropped = new File(["y"], "photo.png", { type: "image/png" });
    vi.mocked(cropImage).mockResolvedValue(cropped);

    const props = baseProps();
    render(<ImageCropper {...props} />);
    loadPreview();

    await userEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(props.onComplete).toHaveBeenCalledWith(cropped);
  });

  it("크롭이 실패하면 알리고 적용을 잠근다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(cropImage).mockRejectedValue(new Error("canvas unavailable"));

    const props = baseProps();
    render(<ImageCropper {...props} />);
    loadPreview();

    await userEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
    expect(props.onComplete).not.toHaveBeenCalled();
  });

  it("원본이 바뀌면 이전 이미지의 치수·배율·위치를 버린다", () => {
    const props = baseProps();
    const view = render(<ImageCropper {...props} />);
    const img = loadPreview();

    const frame = screen.getByRole("application");
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    expect(img).toHaveStyle({ left: `${CENTERED_LEFT + 16}px` });

    fireEvent.change(screen.getByLabelText("배율"), { target: { value: "2" } });
    expect(screen.getByLabelText("배율")).toHaveValue("2");

    view.rerender(<ImageCropper {...props} previewUrl="blob:test/2" />);

    // 새 이미지가 로드되기 전까지는 이전 치수로 적용할 수 없어야 한다.
    expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
    expect(screen.getByLabelText("이미지 불러오는 중")).toBeInTheDocument();
    expect(screen.getByLabelText("배율")).toHaveValue("1");

    // 새 이미지는 이전 배율·위치가 아니라 처음 상태로 그려진다.
    loadPreview();
    expect(img).toHaveStyle({ left: `${CENTERED_LEFT}px` });
  });

  it("이전 이미지가 실패했어도 새 원본에서는 다시 시도할 수 있다", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const props = baseProps();
    const view = render(<ImageCropper {...props} />);
    fireEvent.error(findPreviewImg()!);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    view.rerender(<ImageCropper {...props} previewUrl="blob:test/2" />);
    loadPreview();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "적용" })).toBeEnabled();
  });
});
