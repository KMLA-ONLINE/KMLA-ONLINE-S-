import { Dialog } from "@base-ui/react/dialog";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";

import { cn } from "~/shared/lib/utils";

export interface ViewerImage {
  id: string;
  /** 화면에 그릴 URL. */
  src: string;
  /** 저장 버튼이 쓸 URL. 같은 파일이지만 서버가 첨부로 내려주는 주소다. */
  downloadSrc: string;
  /** alt text이자 헤더 라벨. */
  name: string;
}

const CONTROL_CLASS =
  "flex size-10 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-0";

const SLIDE_TRANSITION = "transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1)";
const SWIPE_MAX_TRIGGER_DISTANCE = 80;
const SWIPE_TRIGGER_RATIO = 0.2;
const SWIPE_RUBBER_BAND = 0.25;
const DRAG_CLICK_TOLERANCE = 6;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2;
const DOUBLE_TAP_DELAY = 250;
const CLICK_SUPPRESSION_TIME = 400;
const MOBILE_MEDIA_QUERY = "(max-width: 639px)";

interface Point {
  x: number;
  y: number;
}

interface ZoomState extends Point {
  scale: number;
}

type GestureMode = "slide" | "pan" | "pinch" | null;

const DEFAULT_ZOOM: ZoomState = { scale: 1, x: 0, y: 0 };

function ControlButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button type="button" className={cn(CONTROL_CLASS, className)} {...props} />
  );
}

function Slide({
  image,
  imageRef,
  zoom,
  isGestureActive,
  onBackdropClick,
  onImageClick,
}: {
  image?: ViewerImage;
  imageRef?: Ref<HTMLImageElement>;
  zoom?: ZoomState;
  isGestureActive: boolean;
  onBackdropClick: () => void;
  onImageClick: (event: ReactMouseEvent<HTMLImageElement>) => void;
}) {
  const imageZoom = zoom ?? DEFAULT_ZOOM;

  return (
    /* 배경 탭으로 닫는 것은 포인터 전용 편의다. 키보드 사용자에게는 헤더의 닫기 버튼과
       Esc가 있으므로 이 div에 키 핸들러나 role을 얹지 않는다 — 슬라이드 하나하나가
       버튼으로 읽히면 낭독 순서가 더 나빠진다. */
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="flex h-full w-full shrink-0 items-center justify-center px-2 sm:px-4"
      onClick={onBackdropClick}
    >
      {image ? (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <img
          ref={imageRef}
          src={image.src}
          alt={image.name}
          draggable={false}
          className={cn(
            "max-h-full max-w-full object-contain will-change-transform select-none sm:cursor-default",
            imageZoom.scale > 1
              ? "cursor-grab active:cursor-grabbing"
              : "cursor-zoom-in",
          )}
          style={{
            transform: `translate3d(${imageZoom.x}px, ${imageZoom.y}px, 0) scale(${imageZoom.scale})`,
            transition: isGestureActive ? "none" : SLIDE_TRANSITION,
          }}
          onClick={onImageClick}
        />
      ) : null}
    </div>
  );
}

function Filmstrip({
  images,
  activeIndex,
  onSelect,
}: {
  images: ViewerImage[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const activeThumbnailRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeThumbnailRef.current?.scrollIntoView({
      block: "nearest",
      inline: "center",
    });
  }, [activeIndex]);

  return (
    <div
      data-testid="image-viewer-filmstrip"
      className="hidden shrink-0 scrollbar-none overflow-x-auto sm:block"
    >
      <div className="mx-auto flex w-max gap-2 px-3 pt-3 pb-[calc(0.75rem+var(--app-safe-b))]">
        {images.map((image, index) => {
          const isActive = index === activeIndex;

          return (
            <button
              key={image.id}
              ref={isActive ? activeThumbnailRef : undefined}
              type="button"
              aria-label={image.name}
              aria-current={isActive}
              onClick={() => onSelect(index)}
              className={cn(
                "size-14 shrink-0 overflow-hidden rounded-lg ring-2 transition focus-visible:ring-white focus-visible:outline-none",
                isActive
                  ? "opacity-100 ring-white"
                  : "opacity-50 ring-transparent hover:opacity-90",
              )}
            >
              <img
                src={image.src}
                alt=""
                draggable={false}
                className="size-full object-cover"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 전체화면 이미지 뷰어.
 *
 * `openImageId`는 "열렸는가, 어느 장에서 열었는가"만 답한다. 일부러 "현재 이미지"를 controlled로
 * 두지 않았다 — 한 장 넘길 때마다 router를 왕복시키면 드래그 도중에 비동기 왕복이 끼어들고,
 * 뒤늦게 도착한 prop이 손가락과 싸운다. 열린 뒤 어느 장을 보고 있는지는 뷰어가 소유한다.
 *
 * 그래서 호출부는 "열렸는지, 무엇으로"와 `onClose`만 책임지면 된다.
 */
export function ImageViewer({
  images,
  openImageId,
  onClose,
}: {
  images: ViewerImage[];
  openImageId: string | null;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const activePointersRef = useRef(new Map<number, Point>());
  const gestureModeRef = useRef<GestureMode>(null);
  const gestureStartRef = useRef<Point | null>(null);
  const dragBaseRef = useRef(0);
  const panBaseRef = useRef<Point>({ x: 0, y: 0 });
  const pinchStartRef = useRef<{
    distance: number;
    midpoint: Point;
    zoom: ZoomState;
  } | null>(null);
  const hasDraggedRef = useRef(false);
  const suppressClicksUntilRef = useRef(0);
  const pendingTapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // pointermove는 연속 이벤트라 pointerup이 도착할 때까지 setState가 아직 커밋되지 않았을 수
  // 있다. 놓는 순간의 임계값 판정은 이 ref를 읽는다.
  const offsetRef = useRef(0);

  const [storedIndex, setStoredIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isGestureActive, setIsGestureActive] = useState(false);
  const [isChromeHidden, setIsChromeHidden] = useState(false);
  const [zoom, setZoom] = useState<ZoomState>(DEFAULT_ZOOM);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const [renderedOpenImageId, setRenderedOpenImageId] = useState<string | null>(
    null,
  );

  useEffect(
    () => () => {
      if (pendingTapRef.current !== null) clearTimeout(pendingTapRef.current);
    },
    [],
  );

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (openImageId === null) return;

    const root = document.documentElement;
    root.classList.add("image-viewer-open");
    return () => root.classList.remove("image-viewer-open");
  }, [openImageId]);

  // 데스크톱에서 좌우 방향키로 넘긴다. Popup의 onKeyDown을 쓰지 않는 이유는 이 뷰어가
  // 게시물 상세 dialog 위에 열려 포커스가 여기까지 오지 않기 때문이고, capture 단계인
  // 이유는 그 아래 dialog가 방향키를 먼저 삼켜 bubble까지 오지 않기 때문이다.
  useEffect(() => {
    if (openImageId === null) return;

    const handleArrowKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      offsetRef.current = 0;
      setOffset(0);
      zoomRef.current = DEFAULT_ZOOM;
      setZoom(DEFAULT_ZOOM);
      setStoredIndex((current) => {
        const clamped = Math.max(0, Math.min(current, images.length - 1));
        const next = event.key === "ArrowLeft" ? clamped - 1 : clamped + 1;
        return Math.max(0, Math.min(next, images.length - 1));
      });
    };

    document.addEventListener("keydown", handleArrowKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleArrowKey, {
        capture: true,
      });
  }, [openImageId, images.length]);

  // 새로 열렸다: 열린 장으로 점프한다. 바깥에서 index를 움직이는 건 이것뿐이다.
  if (renderedOpenImageId !== openImageId) {
    setRenderedOpenImageId(openImageId);
    setStoredIndex(
      Math.max(
        0,
        images.findIndex((image) => image.id === openImageId),
      ),
    );
    setOffset(0);
    setZoom(DEFAULT_ZOOM);
    setIsChromeHidden(false);
  }

  // 뷰어가 열려 있는 동안 첨부 목록이 바뀔 수 있다.
  const index = Math.max(0, Math.min(storedIndex, images.length - 1));
  const activeImage = images[index];

  if (!openImageId || !activeImage) return null;

  const getViewportWidth = () => viewportRef.current?.clientWidth ?? 0;

  const setDragOffset = (value: number) => {
    offsetRef.current = value;
    setOffset(value);
  };

  const setZoomState = (value: ZoomState) => {
    zoomRef.current = value;
    setZoom(value);
  };

  const resetZoom = () => setZoomState(DEFAULT_ZOOM);

  const goTo = (nextIndex: number) => {
    setDragOffset(0);
    if (nextIndex >= 0 && nextIndex < images.length) {
      resetZoom();
      setStoredIndex(nextIndex);
    }
  };

  const isMobileViewport = () =>
    typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_MEDIA_QUERY).matches
      : window.innerWidth < 640;

  const clearPendingTap = () => {
    if (pendingTapRef.current === null) return;
    clearTimeout(pendingTapRef.current);
    pendingTapRef.current = null;
  };

  const markDragged = () => {
    hasDraggedRef.current = true;
    suppressClicksUntilRef.current = Date.now() + CLICK_SUPPRESSION_TIME;
    clearPendingTap();
  };

  const shouldSuppressClick = () => {
    if (
      !hasDraggedRef.current &&
      Date.now() >= suppressClicksUntilRef.current
    ) {
      return false;
    }

    hasDraggedRef.current = false;
    return true;
  };

  const clampZoom = (next: ZoomState): ZoomState => {
    const scale = Math.max(1, Math.min(MAX_ZOOM, next.scale));
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (scale === 1 || !viewport || !image) return DEFAULT_ZOOM;

    const maxX = Math.max(
      0,
      (image.clientWidth * scale - viewport.clientWidth) / 2,
    );
    const maxY = Math.max(
      0,
      (image.clientHeight * scale - viewport.clientHeight) / 2,
    );

    return {
      scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  };

  const getPointerPair = () => {
    const [first, second] = Array.from(activePointersRef.current.values());
    if (!first || !second) return null;

    return {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midpoint: {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      },
    };
  };

  /**
   * 지금 트랙이 실제로 놓여 있는 위치를, 현재 index의 정지 위치로부터의 offset으로 읽는다.
   * 슬라이드 애니메이션이 아직 돌고 있으면 0이 아니고, 드래그를 그 지점에서 이어받는 것이
   * 손가락을 댔을 때 화면이 튀지 않게 하는 방법이다.
   */
  const readRenderedOffset = () => {
    const track = trackRef.current;
    const viewportWidth = getViewportWidth();
    if (!track || viewportWidth === 0) return 0;

    // 변형이 없는 요소는 "none"으로 계산되는데 DOMMatrix가 이를 파싱하지 못한다. 그런 요소는
    // 어차피 이미 정지 상태다.
    const renderedTransform = getComputedStyle(track).transform;
    if (renderedTransform === "none" || typeof DOMMatrix === "undefined") {
      return offsetRef.current;
    }

    const { m41: renderedTranslateX } = new DOMMatrix(renderedTransform);
    return renderedTranslateX + index * viewportWidth;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 컨트롤 위에서는 드래그하지 않고, 마우스로도 드래그하지 않는다 — 마우스의 어포던스는
    // 좌우 화살표다. 터치 포인터는 브라우저가 암묵적으로 캡처하므로 setPointerCapture가
    // 필요 없고, 부르면 후속 click이 이 요소로 리타깃돼서 탭-닫기와 화살표 탭이 깨진다.
    if (
      event.pointerType === "mouse" ||
      (event.target as HTMLElement).closest("button, a")
    ) {
      return;
    }

    const point = { x: event.clientX, y: event.clientY };
    activePointersRef.current.set(event.pointerId, point);

    if (activePointersRef.current.size === 2 && isMobileViewport()) {
      const pair = getPointerPair();
      if (!pair || pair.distance === 0) return;

      markDragged();
      gestureModeRef.current = "pinch";
      pinchStartRef.current = { ...pair, zoom: zoomRef.current };
      setDragOffset(0);
      setIsDragging(false);
      setIsGestureActive(true);
      setIsChromeHidden(true);
      return;
    }

    if (activePointersRef.current.size > 1) {
      markDragged();
      return;
    }

    gestureStartRef.current = point;
    setIsGestureActive(true);

    if (zoomRef.current.scale > 1 && isMobileViewport()) {
      gestureModeRef.current = "pan";
      panBaseRef.current = { x: zoomRef.current.x, y: zoomRef.current.y };
      return;
    }

    const grabbedOffset = readRenderedOffset();

    gestureModeRef.current = "slide";
    dragBaseRef.current = grabbedOffset;
    hasDraggedRef.current = false;
    setDragOffset(grabbedOffset);
    setIsDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) return;
    activePointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (gestureModeRef.current === "pinch") {
      const start = pinchStartRef.current;
      const pair = getPointerPair();
      const viewport = viewportRef.current;
      if (!start || !pair || !viewport || start.distance === 0) return;

      event.preventDefault();
      const viewportRect = viewport.getBoundingClientRect();
      const scale = Math.max(
        1,
        Math.min(MAX_ZOOM, start.zoom.scale * (pair.distance / start.distance)),
      );
      const viewportCenter = {
        x: viewportRect.left + viewport.clientWidth / 2,
        y: viewportRect.top + viewport.clientHeight / 2,
      };
      const startMidpoint = {
        x: start.midpoint.x - viewportCenter.x,
        y: start.midpoint.y - viewportCenter.y,
      };
      const currentMidpoint = {
        x: pair.midpoint.x - viewportCenter.x,
        y: pair.midpoint.y - viewportCenter.y,
      };
      const scaleRatio = scale / start.zoom.scale;

      setZoomState(
        clampZoom({
          scale,
          x: currentMidpoint.x - (startMidpoint.x - start.zoom.x) * scaleRatio,
          y: currentMidpoint.y - (startMidpoint.y - start.zoom.y) * scaleRatio,
        }),
      );
      return;
    }

    const gestureStart = gestureStartRef.current;
    if (!gestureStart) return;

    const distanceX = event.clientX - gestureStart.x;
    const distanceY = event.clientY - gestureStart.y;
    if (Math.hypot(distanceX, distanceY) > DRAG_CLICK_TOLERANCE) {
      markDragged();
    }

    if (gestureModeRef.current === "pan") {
      event.preventDefault();
      setZoomState(
        clampZoom({
          scale: zoomRef.current.scale,
          x: panBaseRef.current.x + distanceX,
          y: panBaseRef.current.y + distanceY,
        }),
      );
      return;
    }

    if (gestureModeRef.current !== "slide") return;
    // 탭 중의 미세한 손가락 흔들림은 슬라이드에 반영하지 않아 이미지가 잠깐 움직이지 않게 한다.
    if (!hasDraggedRef.current) return;

    const viewportWidth = getViewportWidth();
    // 첫 장과 마지막 장의 정지 offset을 현재 index 기준으로 환산한 값.
    const firstSlideOffset = index * viewportWidth;
    const lastSlideOffset = (index - (images.length - 1)) * viewportWidth;
    const draggedOffset = dragBaseRef.current + distanceX;

    if (draggedOffset > firstSlideOffset) {
      setDragOffset(
        firstSlideOffset +
          (draggedOffset - firstSlideOffset) * SWIPE_RUBBER_BAND,
      );
      return;
    }

    if (draggedOffset < lastSlideOffset) {
      setDragOffset(
        lastSlideOffset + (draggedOffset - lastSlideOffset) * SWIPE_RUBBER_BAND,
      );
      return;
    }

    setDragOffset(draggedOffset);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) return;
    activePointersRef.current.delete(event.pointerId);

    if (gestureModeRef.current === "pinch") {
      pinchStartRef.current = null;

      if (activePointersRef.current.size >= 2) {
        const pair = getPointerPair();
        if (pair && pair.distance > 0) {
          pinchStartRef.current = { ...pair, zoom: zoomRef.current };
        }
        return;
      }

      const remainingPointer = activePointersRef.current.values().next().value;
      if (remainingPointer) {
        gestureModeRef.current = "pan";
        gestureStartRef.current = remainingPointer;
        panBaseRef.current = {
          x: zoomRef.current.x,
          y: zoomRef.current.y,
        };
        return;
      }

      gestureModeRef.current = null;
      gestureStartRef.current = null;
      setIsGestureActive(false);
      return;
    }

    if (activePointersRef.current.size > 0) return;

    const gestureMode = gestureModeRef.current;
    gestureModeRef.current = null;
    gestureStartRef.current = null;
    setIsGestureActive(false);

    if (gestureMode === "pan") return;
    if (gestureMode !== "slide") return;

    setIsDragging(false);

    const viewportWidth = getViewportWidth();
    if (viewportWidth === 0) {
      setDragOffset(0);
      return;
    }

    const releasedOffset = offsetRef.current;
    const draggedDistance = releasedOffset - dragBaseRef.current;
    const triggerDistance = Math.min(
      SWIPE_MAX_TRIGGER_DISTANCE,
      viewportWidth * SWIPE_TRIGGER_RATIO,
    );
    // 트랙이 놓인 위치를 "장" 단위로 환산한 값. 손가락이 충분히 이동했으면 다음 장으로,
    // 아니면 가장 가까운 장으로 스냅한다.
    const position = index - releasedOffset / viewportWidth;
    const target =
      Math.abs(draggedDistance) < triggerDistance
        ? Math.round(position)
        : draggedDistance < 0
          ? Math.ceil(position)
          : Math.floor(position);

    goTo(Math.min(images.length - 1, Math.max(0, target)));
  };

  // 스와이프는 손가락 아래에 있던 것에 대한 click으로 끝난다. 그걸 배경 탭으로 읽으면 안 된다.
  const handleBackdropClick = () => {
    if (shouldSuppressClick()) return;
    clearPendingTap();
    onClose();
  };

  const handleImageClick = (event: ReactMouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
    if (!isMobileViewport() || shouldSuppressClick()) return;

    if (pendingTapRef.current !== null) {
      clearPendingTap();

      if (zoomRef.current.scale > 1) {
        resetZoom();
        return;
      }

      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      setZoomState(
        clampZoom({
          scale: DOUBLE_TAP_ZOOM,
          x: x * (1 - DOUBLE_TAP_ZOOM),
          y: y * (1 - DOUBLE_TAP_ZOOM),
        }),
      );
      setIsChromeHidden(true);
      return;
    }

    pendingTapRef.current = setTimeout(() => {
      pendingTapRef.current = null;
      setIsChromeHidden((hidden) => !hidden);
    }, DOUBLE_TAP_DELAY);
  };

  return (
    /* Base UI의 스크롤 잠금은 중첩 dialog에서 폭 보정이 겹치므로 사용하지 않는다. 대신
       뷰어가 열린 동안 루트에 image-viewer-open을 붙여 스크롤과 스크롤바만 직접 막는다. */
    <Dialog.Root
      open
      modal="trap-focus"
      onOpenChange={(open) => !open && onClose()}
    >
      <Dialog.Portal>
        {/* `forceRender`가 없으면 백드롭이 아예 그려지지 않는다 — Base UI는 중첩된 dialog의
            백드롭을 기본적으로 건너뛴다(부모 것이 이미 깔려 있다고 보기 때문에). 이 뷰어는
            게시물 상세 안에서도 열리는데, 거기서는 부모의 옅은 백드롭만 남아 흰 배경에 흰
            글씨가 되고 사진 뒤로 모달이 비친다. 사진을 보는 화면은 항상 자기 배경을 가져야 한다.

            아래 dialog도 `z-50`이라 같은 층에서 DOM 순서에 기대지 않도록 한 단 올린다. */}
        <Dialog.Backdrop
          forceRender
          className="fixed inset-0 z-60 bg-black/95 duration-150 data-open:animate-in data-open:fade-in-0"
        />
        <Dialog.Popup
          // 열자마자 닫기/다운로드 버튼에 포커스 링이 박히지 않게 popup 자신으로 보낸다.
          // 방향키는 window 리스너, Esc는 Base UI가 처리하므로 여기 있는 컨트롤 중
          // 포커스를 먼저 받아야 하는 것은 없다.
          ref={popupRef}
          initialFocus={popupRef}
          className="fixed inset-0 z-60 flex flex-col duration-150 outline-none data-open:animate-in data-open:fade-in-0"
        >
          <Dialog.Title className="sr-only">{activeImage.name}</Dialog.Title>

          <header
            data-testid="image-viewer-header"
            className={cn(
              "absolute inset-x-0 top-0 z-10 flex items-center gap-2 pt-[max(0.5rem,var(--app-safe-t))] pr-[max(0.5rem,var(--app-safe-r))] pb-2 pl-[max(0.5rem,var(--app-safe-l))] transition-opacity duration-150 sm:static sm:z-auto sm:shrink-0 sm:transition-none md:p-3",
              isChromeHidden
                ? "pointer-events-none opacity-0 sm:pointer-events-auto sm:opacity-100"
                : "opacity-100",
            )}
          >
            {/* 파일 이름은 화면에 띄우지 않는다. 스크린리더용 제목과 저장 파일명에는 그대로 쓴다. */}
            <div className="min-w-0 flex-1 px-2">
              {images.length > 1 ? (
                <p className="text-sm text-white/70">
                  {index + 1} / {images.length}
                </p>
              ) : null}
            </div>
            <a
              href={activeImage.downloadSrc}
              download={activeImage.name}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="다운로드"
              className={CONTROL_CLASS}
            >
              <DownloadIcon className="size-5" />
            </a>
            <Dialog.Close render={<ControlButton aria-label="닫기" />}>
              <XIcon className="size-5" />
            </Dialog.Close>
          </header>

          <div
            ref={viewportRef}
            data-testid="image-viewer-viewport"
            className="relative min-h-0 flex-1 touch-none overflow-hidden sm:touch-pan-y"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <div
              ref={trackRef}
              data-testid="image-viewer-track"
              className="flex h-full w-full"
              style={{
                transform: `translateX(calc(${-index * 100}% + ${offset}px))`,
                transition: isDragging ? "none" : SLIDE_TRANSITION,
              }}
            >
              {images.map((image, slideIndex) => (
                <Slide
                  key={image.id}
                  // 양옆 한 장씩만 디코딩한다. 빈 슬롯도 트랙의 기하는 유지하므로 transform은
                  // 계속 100%의 정수배로 남는다.
                  image={Math.abs(slideIndex - index) <= 1 ? image : undefined}
                  imageRef={slideIndex === index ? imageRef : undefined}
                  zoom={slideIndex === index ? zoom : undefined}
                  isGestureActive={isGestureActive}
                  onBackdropClick={handleBackdropClick}
                  onImageClick={handleImageClick}
                />
              ))}
            </div>

            {/* 터치 기기는 스와이프로 넘긴다. 거기서 화살표는 이미지를 가리기만 한다. */}
            <div className="absolute inset-y-0 left-2 hidden items-center sm:left-4 sm:flex">
              <ControlButton
                aria-label="이전 이미지"
                disabled={index === 0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => goTo(index - 1)}
                className="bg-black/40 backdrop-blur-xs"
              >
                <ChevronLeftIcon className="size-6" />
              </ControlButton>
            </div>
            <div className="absolute inset-y-0 right-2 hidden items-center sm:right-4 sm:flex">
              <ControlButton
                aria-label="다음 이미지"
                disabled={index === images.length - 1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => goTo(index + 1)}
                className="bg-black/40 backdrop-blur-xs"
              >
                <ChevronRightIcon className="size-6" />
              </ControlButton>
            </div>
          </div>

          {images.length > 1 ? (
            <Filmstrip images={images} activeIndex={index} onSelect={goTo} />
          ) : (
            // 한 장뿐이어도 필름스트립 높이를 비워둔다. 안 그러면 이미지 영역이 그만큼
            // 늘어나서, 여러 장짜리 게시물과 한 장짜리 게시물의 크기가 달라 보인다.
            <div
              className="hidden h-[calc(2.5rem+var(--app-safe-b))] shrink-0 sm:block"
              aria-hidden="true"
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
