export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// -0 → +0. `-dx / dispScale`은 dx가 0일 때 -0을 낳는데, 수학적으로는 0이어도
// `Object.is`나 직렬화에서 튀므로 눌러 둔다.
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * 프레임을 빈틈없이 덮는 배율과, 그 상태에서 허용되는 pan 한계.
 *
 * 미리보기(`<img>` 위치 계산)와 실제 크롭이 같은 좌표 계약을 공유하도록 한 곳에서 만든다.
 */
export function coverFit(params: {
  imageWidth: number;
  imageHeight: number;
  frameWidth: number;
  frameHeight: number;
  zoom: number;
}): {
  baseScale: number;
  dispScale: number;
  maxOffsetX: number;
  maxOffsetY: number;
} {
  const { imageWidth, imageHeight, frameWidth, frameHeight, zoom } = params;
  const baseScale = Math.max(
    frameWidth / imageWidth,
    frameHeight / imageHeight,
  );
  const dispScale = baseScale * zoom;

  return {
    baseScale,
    dispScale,
    maxOffsetX: Math.max(0, (imageWidth * dispScale - frameWidth) / 2),
    maxOffsetY: Math.max(0, (imageHeight * dispScale - frameHeight) / 2),
  };
}

/** 화면의 zoom·offset을 원본 이미지 좌표의 잘라낼 사각형으로 옮긴다. */
export function coverCropRect(params: {
  imageWidth: number;
  imageHeight: number;
  frameWidth: number;
  frameHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}): CropRect {
  const { imageWidth, imageHeight, frameWidth, frameHeight, offsetX, offsetY } =
    params;
  const { dispScale, maxOffsetX, maxOffsetY } = coverFit(params);

  const ox = clamp(offsetX, -maxOffsetX, maxOffsetX);
  const oy = clamp(offsetY, -maxOffsetY, maxOffsetY);

  const dx = frameWidth / 2 - (imageWidth * dispScale) / 2 + ox;
  const dy = frameHeight / 2 - (imageHeight * dispScale) / 2 + oy;

  return {
    x: normalizeZero(-dx / dispScale),
    y: normalizeZero(-dy / dispScale),
    width: frameWidth / dispScale,
    height: frameHeight / dispScale,
  };
}

/** 종횡비를 유지한 채 긴 변을 `maxEdge`로 눌러 담는다. 원본보다 키우지는 않는다. */
export function fitOutputSize(
  rect: Pick<CropRect, "width" | "height">,
  maxEdge: number,
): { width: number; height: number } {
  const longer = Math.max(rect.width, rect.height);
  const scale = longer > maxEdge ? maxEdge / longer : 1;

  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null")),
      "image/png",
    );
  });
}

/**
 * 원본에서 `rect`를 잘라 `output` 크기의 PNG `File`로 만든다.
 *
 * PNG(무손실)로 내보내는 건 의도다. 이 결과는 대개 곧바로 `compressImage()`를 거쳐 WebP가
 * 되는데, 중간 단계에서 한 번 더 손실 압축을 하면 화질만 깎인다. `fitOutputSize()`가 이미
 * 치수를 목표까지 줄여 놓으므로 무손실이어도 크기가 터지지 않는다.
 */
export async function cropImage(
  file: File,
  rect: CropRect,
  output: { width: number; height: number },
): Promise<File> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });

  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(output.width));
    canvas.height = Math.max(1, Math.round(output.height));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      bitmap,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const blob = await canvasToBlob(canvas);
    const base = file.name.replace(/\.[^./\\]+$/, "") || "image";

    return new File([blob], `${base}.png`, { type: "image/png" });
  } finally {
    bitmap.close();
  }
}
