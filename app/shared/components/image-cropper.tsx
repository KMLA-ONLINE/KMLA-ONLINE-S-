import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";

import {
  coverCropRect,
  coverFit,
  cropImage,
  fitOutputSize,
} from "~/shared/lib/image/crop";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;
/** 방향키 한 번에 움직이는 거리(px). Shift를 누르면 4배. */
const PAN_STEP = 16;
/** 이 차이 안으로 들어온 배율은 프레임을 정확히 덮는 1로 맞춘다. 1 근처에 얇은 여백이 남지 않게 한다. */
const COVER_SNAP = 0.02;
/**
 * 대화상자에서 크롭 프레임 말고 세로 자리를 차지하는 것들(머리글, 여백, 확대 막대, 오류 문구)의
 * 높이. 프레임 높이 상한은 대화상자 높이(`--cropper-dialog-h`)에서 이 값을 뺀 것이다.
 */
const DIALOG_CHROME_HEIGHT = "11rem";
/** 크롭 프레임과 확대 막대가 함께 쓰는 최대 너비. */
const FRAME_MAX_WIDTH = "24rem";

/**
 * 1을 사이에 두고 넘어가는 배율 변화는 1에서 멈춘다. 축소 하한이 임의의 소수라, 버튼으로 일정하게
 * 움직이면 프레임을 정확히 덮는 상태를 건너뛴다.
 */
function stepZoom(from: number, delta: number): number {
  const next = from + delta;
  return (from - 1) * (next - 1) < 0 ? 1 : next;
}

const PAN_KEYS: Record<string, { x: number; y: number } | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

interface ImageCropperProps {
  /** 자를 원본. `useImageCrop()`의 `cropperProps`가 그대로 넘겨준다. */
  file: File;
  /** 원본의 object URL. 수명은 `useImageCrop()`이 관리한다. */
  previewUrl: string;
  /** 크롭 프레임의 가로/세로 비. 아바타는 `1`, 배너는 `3` 같은 값. */
  aspect: number;
  /** 결과물 긴 변의 상한(px). */
  maxOutputEdge: number;
  /** 프레임을 원형으로 마스킹해 보여준다. 결과물은 여전히 사각형이다. */
  round?: boolean;
  /**
   * 주면 사진 전체가 프레임 안에 들어갈 때까지 축소할 수 있고, 프레임에서 사진이 덮지 않는 자리를
   * 이 색으로 채워 저장한다. 주지 않으면 사진이 늘 프레임을 빈틈없이 덮는다.
   */
  letterboxColor?: string;
  title?: string;
  onCancel: () => void;
  onComplete: (cropped: File) => void;
}

/**
 * 드래그나 방향키로 위치를, 슬라이더로 배율을 맞춰 이미지를 잘라내는 다이얼로그.
 *
 * 좌표 계산은 전부 `~/shared/lib/image/crop`의 순수 함수가 갖는다. 미리보기와 저장이 같은
 * `coverFit()` 결과로 clamp된 offset을 쓰기 때문에 둘이 어긋나지 않는다 — 화면 회전처럼
 * 사용자가 건드리지 않은 채 프레임 크기만 바뀌는 경우까지 포함해서다. (offset을 state에 있는
 * 값 그대로 그리면, 좁아진 프레임에서는 미리보기에만 빈 여백이 보이고 저장은 clamp된 다른
 * 위치로 나간다.)
 */
export function ImageCropper({
  file,
  previewUrl,
  aspect,
  maxOutputEdge,
  round = false,
  letterboxColor,
  title = "사진 편집",
  onCancel,
  onComplete,
}: ImageCropperProps) {
  const [image, setImage] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // 원본이 교체되면 이전 이미지의 치수·배율·위치·에러가 남아 있으면 안 된다. 새 이미지가 로드되기
  // 전에 이전 치수로 적용되거나, 실패했던 이미지의 `error`가 남아 적용 버튼이 계속 잠긴다.
  // 렌더 중 조정은 prop 변화에 상태를 맞추는 React의 정식 패턴이다 — 이펙트로 하면 한 프레임
  // 늦게 초기화돼 그 사이에 이전 이미지가 보인다.
  const [lastUrl, setLastUrl] = useState(previewUrl);
  if (previewUrl !== lastUrl) {
    setLastUrl(previewUrl);
    setImage(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError(false);
  }

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!frameElement) return;

    const measure = () => {
      const { clientWidth: width, clientHeight: height } = frameElement;
      if (width === 0 || height === 0) return;
      setFrame((current) =>
        current?.width === width && current.height === height
          ? current
          : { width, height },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frameElement);
    return () => observer.disconnect();
  }, [frameElement]);

  const ready = image !== null && frame !== null;

  const fitAt = (z: number) =>
    image && frame
      ? coverFit({
          imageWidth: image.width,
          imageHeight: image.height,
          frameWidth: frame.width,
          frameHeight: frame.height,
          zoom: z,
        })
      : null;

  // 축소 하한. 여백을 채울 색이 없으면 프레임을 덮는 배율(1) 아래로 내려가지 않는다.
  const minZoom = letterboxColor ? (fitAt(1)?.containZoom ?? 1) : 1;

  // 미리보기와 저장이 공유하는 배율. 프레임 크기가 바뀌면 하한도 조금 움직이므로, state의 raw
  // zoom이 하한 아래로 남을 수 있다 — offset과 같은 이유로 직접 쓰지 않는다.
  const shownZoom = Math.max(minZoom, zoom);
  const fit = fitAt(shownZoom);

  // 미리보기와 저장이 공유하는 유일한 위치 값. state의 raw offset은 프레임이 줄어들면 한계를
  // 넘을 수 있으므로 직접 쓰지 않는다.
  const shownOffset = fit
    ? { x: clamp(offset.x, fit.maxOffsetX), y: clamp(offset.y, fit.maxOffsetY) }
    : offset;

  const applyTransform = (
    nextZoom: number,
    nextOffset: { x: number; y: number },
  ) => {
    const snapped = Math.abs(nextZoom - 1) < COVER_SNAP ? 1 : nextZoom;
    const z = Math.min(MAX_ZOOM, Math.max(minZoom, snapped));
    setZoom(z);

    const nextFit = fitAt(z);
    if (!nextFit) {
      setOffset(nextOffset);
      return;
    }

    const { maxOffsetX, maxOffsetY } = nextFit;

    setOffset({
      x: clamp(nextOffset.x, maxOffsetX),
      y: clamp(nextOffset.y, maxOffsetY),
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (busy || !ready) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: shownOffset.x,
      baseY: shownOffset.y,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    applyTransform(shownZoom, {
      x: drag.baseX + (event.clientX - drag.startX),
      y: drag.baseY + (event.clientY - drag.startY),
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
  };

  // 포인터가 없는 사용자도 위치를 고를 수 있어야 한다. 방향키는 드래그와 같은 방향으로 — 오른쪽
  // 화살표는 이미지를 오른쪽으로 민다(= 왼쪽 영역이 프레임에 들어온다).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busy || !ready) return;

    const direction = PAN_KEYS[event.key];
    if (!direction) return;

    event.preventDefault();
    const step = event.shiftKey ? PAN_STEP * 4 : PAN_STEP;
    applyTransform(shownZoom, {
      x: shownOffset.x + direction.x * step,
      y: shownOffset.y + direction.y * step,
    });
  };

  const onApply = async () => {
    if (!image || !frame || busy) return;
    setBusy(true);
    setError(false);

    try {
      const rect = coverCropRect({
        imageWidth: image.width,
        imageHeight: image.height,
        frameWidth: frame.width,
        frameHeight: frame.height,
        zoom: shownZoom,
        offsetX: shownOffset.x,
        offsetY: shownOffset.y,
      });
      onComplete(
        await cropImage(
          file,
          rect,
          fitOutputSize(rect, maxOutputEdge, aspect),
          letterboxColor,
        ),
      );
    } catch (cause) {
      console.error(
        "[ImageCropper] 크롭 실패",
        { name: file.name, type: file.type },
        cause,
      );
      setError(true);
      setBusy(false);
    }
  };

  const imageStyle =
    image && frame && fit
      ? {
          width: image.width * fit.dispScale,
          height: image.height * fit.dispScale,
          left: (frame.width - image.width * fit.dispScale) / 2 + shownOffset.x,
          top:
            (frame.height - image.height * fit.dispScale) / 2 + shownOffset.y,
        }
      : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-(--cropper-dialog-h) flex-col gap-0 overflow-hidden p-0 [--cropper-dialog-h:100svh] max-sm:top-0 max-sm:left-0 max-sm:h-(--cropper-dialog-h) max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-lg sm:[--cropper-dialog-h:90svh]"
      >
        <DialogHeader className="flex-row items-center gap-2 border-b p-3 text-left">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            disabled={busy}
            aria-label="취소"
          >
            <XIcon />
          </Button>
          <DialogTitle className="flex-1 text-base">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            드래그나 방향키로 위치를, 슬라이더로 배율을 맞춘 뒤 적용합니다.
          </DialogDescription>
          <Button
            size="sm"
            onClick={() => void onApply()}
            disabled={busy || !ready || error}
          >
            {busy ? (
              <Spinner data-icon="inline-start" aria-label="처리 중" />
            ) : null}
            적용
          </Button>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* 너비를 높이 상한에서 거꾸로 잡는다. 감싼 상자가 높이만 줄면 프레임 아래가 가려진 채
              잘리고, 프레임이 다 보이지 않으면 사용자는 실제로 저장될 자리를 볼 수 없다. 확대 막대도
              같은 너비를 써서 조작하는 프레임과 폭이 맞는다. */}
          <div
            className="mx-auto flex shrink-0 flex-col gap-4"
            style={{
              width: `min(100%, ${FRAME_MAX_WIDTH}, calc((var(--cropper-dialog-h) - ${DIALOG_CHROME_HEIGHT}) * ${aspect}))`,
            }}
          >
            <div className="overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions --
                2차원 조작 표면에 맞는 interactive role이 ARIA에 없다. `application`이어야 스크린 리더가
                방향키를 가로채지 않는다. 포커스(`tabIndex`)·방향키 핸들러·`aria-label`/`aria-describedby`는 갖췄다. */}
              <div
                ref={setFrameElement}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
                tabIndex={busy || !ready ? -1 : 0}
                style={{
                  aspectRatio: String(aspect),
                  backgroundColor: letterboxColor,
                }}
                className="relative w-full touch-none overflow-hidden select-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
                role="application"
                aria-label="크롭 영역"
                aria-describedby="image-cropper-help"
              >
                <img
                  src={previewUrl}
                  alt=""
                  draggable={false}
                  onLoad={(event) => {
                    const { naturalWidth: width, naturalHeight: height } =
                      event.currentTarget;
                    if (width === 0 || height === 0) {
                      setError(true);
                      return;
                    }
                    setImage({ width, height });
                  }}
                  onError={() => {
                    console.error("[ImageCropper] 미리보기 로드 실패", {
                      name: file.name,
                      type: file.type,
                      size: file.size,
                    });
                    setError(true);
                  }}
                  style={imageStyle}
                  className={cn(
                    "pointer-events-none absolute max-w-none",
                    imageStyle ? "visible" : "invisible",
                  )}
                />

                {!ready && !error ? (
                  <div className="absolute inset-0 grid place-items-center">
                    <Spinner
                      className="size-5"
                      aria-label="이미지 불러오는 중"
                    />
                  </div>
                ) : null}

                {round ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
                  />
                ) : null}
              </div>
            </div>

            <p id="image-cropper-help" className="sr-only">
              드래그하거나 방향키로 이미지 위치를 조정합니다. Shift와 함께
              누르면 더 크게 움직입니다.
            </p>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() =>
                  applyTransform(stepZoom(shownZoom, -ZOOM_STEP), shownOffset)
                }
                disabled={busy || !ready || shownZoom <= minZoom}
                aria-label="축소"
              >
                <MinusIcon />
              </Button>
              <input
                type="range"
                min={minZoom}
                max={MAX_ZOOM}
                // 하한이 임의의 소수라 고정 간격을 주면 1과 최대 배율이 눈금에서 벗어난다.
                step="any"
                value={shownZoom}
                onChange={(event) =>
                  applyTransform(Number(event.target.value), shownOffset)
                }
                disabled={busy || !ready}
                aria-label="배율"
                className="h-1 flex-1 cursor-pointer accent-primary"
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() =>
                  applyTransform(stepZoom(shownZoom, ZOOM_STEP), shownOffset)
                }
                disabled={busy || !ready || shownZoom >= MAX_ZOOM}
                aria-label="확대"
              >
                <PlusIcon />
              </Button>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-center text-xs text-destructive">
              이미지를 처리하지 못했습니다. 다른 파일로 다시 시도해 주세요.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
