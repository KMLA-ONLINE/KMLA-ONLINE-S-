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
 *
 * `zoom`은 덮는 배율에 곱하는 값이다. 1 미만이면 이미지가 어느 축에서 프레임보다 작아지는데,
 * 그 축에서는 이미지가 프레임 밖으로 나가지 않는 범위까지만 움직인다. 큰 축은 지금처럼 프레임을
 * 계속 덮는 범위다. 두 경우 모두 한계는 표시 크기와 프레임 크기 차이의 절반이다.
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
  /** 이미지 전체가 프레임 안에 들어가는 `zoom`. 늘 1 이하다. */
  containZoom: number;
} {
  const { imageWidth, imageHeight, frameWidth, frameHeight, zoom } = params;
  const widthScale = frameWidth / imageWidth;
  const heightScale = frameHeight / imageHeight;
  const baseScale = Math.max(widthScale, heightScale);
  const dispScale = baseScale * zoom;

  return {
    baseScale,
    dispScale,
    maxOffsetX: Math.abs(imageWidth * dispScale - frameWidth) / 2,
    maxOffsetY: Math.abs(imageHeight * dispScale - frameHeight) / 2,
    containZoom: Math.min(widthScale, heightScale) / baseScale,
  };
}

/**
 * 화면의 zoom·offset을 원본 이미지 좌표의 잘라낼 사각형으로 옮긴다.
 *
 * `zoom`이 1 미만이면 사각형이 이미지 밖까지 걸칠 수 있다. 그 부분은 `cropImage()`가 채운다.
 */
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

/**
 * 종횡비를 유지한 채 긴 변을 `maxEdge`로 눌러 담는다. 원본보다 키우지는 않는다.
 *
 * `aspect`를 주면 결과를 그 비율에 정확히 맞춘다. 크롭 영역은 화면 프레임에서 온 소수라 두 변을
 * 따로 반올림하면 1201×300처럼 비율이 1px 어긋나고, 그룹 커버처럼 `width = height * 4`를
 * 요구하는 DB 검사에 걸린다.
 */
export function fitOutputSize(
  rect: Pick<CropRect, "width" | "height">,
  maxEdge: number,
  aspect?: number,
): { width: number; height: number } {
  const longer = Math.max(rect.width, rect.height);
  const scale = longer > maxEdge ? maxEdge / longer : 1;
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  if (!aspect) return { width, height };

  if (aspect >= 1) {
    const lockedHeight = Math.max(
      1,
      Math.min(Math.round(width / aspect), Math.floor(maxEdge / aspect)),
    );
    return { width: Math.round(lockedHeight * aspect), height: lockedHeight };
  }
  const lockedWidth = Math.max(
    1,
    Math.min(Math.round(height * aspect), Math.floor(maxEdge * aspect)),
  );
  return { width: lockedWidth, height: Math.round(lockedWidth / aspect) };
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
 * 잘라낼 사각형 중 실제 이미지에 걸친 부분(`source`)과, 그 부분이 결과물에 그려질 자리(`dest`).
 *
 * 사각형이 이미지 안에 있으면 `source`는 사각형 그대로, `dest`는 결과물 전체다. 이미지와 전혀
 * 겹치지 않으면 `null`이다. 이미지 밖 영역을 `drawImage`에 그대로 넘기지 않는 건 그 처리가
 * 브라우저마다 달랐던 탓이다 — 겹치는 부분만 직접 그려 어디서든 같은 결과를 낸다.
 */
export function clipCropRect(
  rect: CropRect,
  image: { width: number; height: number },
  output: { width: number; height: number },
): { source: CropRect; dest: CropRect } | null {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(image.width, rect.x + rect.width);
  const bottom = Math.min(image.height, rect.y + rect.height);
  if (right <= left || bottom <= top) return null;

  const scaleX = output.width / rect.width;
  const scaleY = output.height / rect.height;

  return {
    source: { x: left, y: top, width: right - left, height: bottom - top },
    dest: {
      x: (left - rect.x) * scaleX,
      y: (top - rect.y) * scaleY,
      width: (right - left) * scaleX,
      height: (bottom - top) * scaleY,
    },
  };
}

/**
 * 원본에서 `rect`를 잘라 `output` 크기의 PNG `File`로 만든다.
 *
 * PNG(무손실)로 내보내는 건 의도다. 이 결과는 대개 곧바로 `compressImage()`를 거쳐 WebP가
 * 되는데, 중간 단계에서 한 번 더 손실 압축을 하면 화질만 깎인다. `fitOutputSize()`가 이미
 * 치수를 목표까지 줄여 놓으므로 무손실이어도 크기가 터지지 않는다.
 *
 * `rect`가 이미지 밖까지 걸치면 그 자리만 `background` 색으로 채운다. 주지 않으면 투명하다.
 * 이미지 안의 투명한 픽셀은 어느 쪽이든 투명하게 남는다.
 */
export async function cropImage(
  file: File,
  rect: CropRect,
  output: { width: number; height: number },
  background?: string,
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

    const clip = clipCropRect(rect, bitmap, canvas);

    // 이미지가 덮지 않는 자리만 칠한다. 캔버스 전체를 먼저 칠하면 투명 PNG의 투명한 부분까지
    // 배경색이 된다. 바깥 사각형에서 이미지 자리를 뚫은(evenodd) 영역이다.
    if (background) {
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      if (clip) {
        ctx.rect(clip.dest.x, clip.dest.y, clip.dest.width, clip.dest.height);
      }
      ctx.fillStyle = background;
      ctx.fill("evenodd");
    }

    if (clip) {
      const { source, dest } = clip;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        bitmap,
        source.x,
        source.y,
        source.width,
        source.height,
        dest.x,
        dest.y,
        dest.width,
        dest.height,
      );
    }

    const blob = await canvasToBlob(canvas);
    const base = file.name.replace(/\.[^./\\]+$/, "") || "image";

    return new File([blob], `${base}.png`, { type: "image/png" });
  } finally {
    bitmap.close();
  }
}
