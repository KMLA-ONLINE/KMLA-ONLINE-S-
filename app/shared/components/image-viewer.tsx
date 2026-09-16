import { Dialog } from "@base-ui/react/dialog";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  XIcon,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";

import { cn } from "~/shared/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

export interface ViewerImage {
  id: string;
  /** 화면에 그릴 URL. 크게 보는 자리라 언제나 원본이다. */
  src: string;
  /**
   * 하단 썸네일 목록이 그릴 URL. 없으면 `src`로 떨어진다.
   *
   * 이게 따로 있는 이유는 그 목록이 **묶음의 모든 이미지**를 한 번에 그리기 때문이다.
   * 사진 열 장짜리 게시물을 열면 56px 칸 열 개를 채우려고 원본 열 장을 받게 된다.
   */
  thumbSrc?: string;
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
const DRAG_START_TOLERANCE = 12;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2;
const DOUBLE_TAP_DELAY = 250;
const CLICK_SUPPRESSION_TIME = 400;

interface Point {
  x: number;
  y: number;
}

interface ZoomState extends Point {
  scale: number;
}

interface ZoomMetrics {
  viewportLeft: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
}

type GestureMode = "slide" | "pan" | "pinch" | null;

const DEFAULT_ZOOM: ZoomState = { scale: 1, x: 0, y: 0 };

function hasDistinctThumbnail(image: ViewerImage): boolean {
  return Boolean(image.thumbSrc && image.thumbSrc !== image.src);
}

const ControlButton = forwardRef<HTMLButtonElement, ComponentProps<"button">>(
  function ControlButton({ className, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(CONTROL_CLASS, className)}
        {...props}
      />
    );
  },
);

function ViewerSlideImage({
  image,
  imageRef,
  zoom,
  isGestureActive,
  showOriginal,
  onImageClick,
}: {
  image: ViewerImage;
  imageRef?: Ref<HTMLImageElement>;
  zoom: ZoomState;
  isGestureActive: boolean;
  /** 원본은 decode까지 끝난 뒤에만 축소본 위로 올린다. */
  showOriginal: boolean;
  onImageClick: (event: ReactMouseEvent<HTMLImageElement>) => void;
}) {
  const thumbnailSrc =
    image.thumbSrc && image.thumbSrc !== image.src ? image.thumbSrc : undefined;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <img
      ref={imageRef}
      src={showOriginal || !thumbnailSrc ? image.src : thumbnailSrc}
      alt={image.name}
      crossOrigin="anonymous"
      draggable={false}
      className={cn(
        "max-h-full max-w-full object-contain will-change-transform select-none sm:cursor-default",
        zoom.scale > 1
          ? "cursor-grab active:cursor-grabbing"
          : "cursor-zoom-in",
      )}
      style={{
        transform:
          "translate3d(var(--image-viewer-zoom-x, 0px), var(--image-viewer-zoom-y, 0px), 0) scale(var(--image-viewer-zoom-scale, 1))",
        transition: isGestureActive ? "none" : SLIDE_TRANSITION,
      }}
      onClick={onImageClick}
    />
  );
}

function Slide({
  image,
  imageRef,
  zoom,
  isGestureActive,
  showOriginal,
  onBackdropClick,
  onImageClick,
}: {
  image?: ViewerImage;
  imageRef?: Ref<HTMLImageElement>;
  zoom?: ZoomState;
  isGestureActive: boolean;
  showOriginal: boolean;
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
        <ViewerSlideImage
          image={image}
          imageRef={imageRef}
          zoom={imageZoom}
          isGestureActive={isGestureActive}
          showOriginal={showOriginal}
          onImageClick={onImageClick}
        />
      ) : null}
    </div>
  );
}

function Filmstrip({
  images,
  activeIndex,
  onSelect,
  className,
  testId = "image-viewer-filmstrip",
  screen,
}: {
  images: ViewerImage[];
  activeIndex: number;
  onSelect: (index: number) => void;
  className?: string;
  testId?: string;
  screen: "desktop" | "mobile";
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeThumbnailRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const isDesktop = window.matchMedia?.("(min-width: 640px)").matches;
    if (
      (screen === "desktop" && !isDesktop) ||
      (screen === "mobile" && isDesktop)
    ) {
      return;
    }

    const scroller = scrollerRef.current;
    const thumbnail = activeThumbnailRef.current;
    if (!scroller || !thumbnail) return;

    /*
      `scrollIntoView`는 스크롤 조상을 전부 훑는다. 모바일 필름스트립은 `overflow-hidden`인
      슬라이드 뷰포트 안에 놓여 있고, 그 뷰포트는 트랙이 사진 수만큼 넓어서 가로로 밀 자리가
      있다. 썸네일을 가운데로 보내려다 뷰포트까지 밀면 화면 전체가 옆으로 어긋나는데, 페이징은
      transform으로 하므로 그 어긋남은 되돌아오지 않는다. 스크롤은 이 목록 안에서만 한다.
    */
    const scrollerRect = scroller.getBoundingClientRect();
    const thumbnailRect = thumbnail.getBoundingClientRect();
    if (
      thumbnailRect.left >= scrollerRect.left &&
      thumbnailRect.right <= scrollerRect.right
    ) {
      return;
    }
    const toCenter =
      thumbnailRect.left -
      scrollerRect.left -
      (scrollerRect.width - thumbnailRect.width) / 2;
    scroller.scrollTo({
      left: scroller.scrollLeft + toCenter,
      behavior: "smooth",
    });
  }, [activeIndex, screen]);

  return (
    <div
      ref={scrollerRef}
      data-testid={testId}
      className={cn("shrink-0 scrollbar-none overflow-x-auto", className)}
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
                src={image.thumbSrc ?? image.src}
                alt=""
                crossOrigin="anonymous"
                draggable={false}
                loading="lazy"
                className="size-full object-cover"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function startDownload(image: ViewerImage) {
  const anchor = document.createElement("a");
  anchor.href = image.downloadSrc;
  anchor.download = image.name;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function DownloadControl({
  activeImage,
  images,
  allowDownloadAll,
}: {
  activeImage: ViewerImage;
  images: ViewerImage[];
  allowDownloadAll: boolean;
}) {
  if (!allowDownloadAll || images.length < 2) {
    return (
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
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label="다운로드 옵션"
        className={CONTROL_CLASS}
      >
        <DownloadIcon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" positionerClassName="z-[70]">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => startDownload(activeImage)}>
            <DownloadIcon />이 이미지 다운로드
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => images.forEach(startDownload)}>
            <DownloadIcon />
            전체 이미지 다운로드
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
  allowDownloadAll = false,
}: {
  images: ViewerImage[];
  openImageId: string | null;
  onClose: () => void;
  /** 게시물의 이미지 묶음에서만 전체 다운로드를 연다. */
  allowDownloadAll?: boolean;
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
  const lastPointerTypeRef = useRef<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingTrackOffsetRef = useRef<number | null>(null);
  const pendingZoomRef = useRef<ZoomState | null>(null);
  const zoomMetricsRef = useRef<ZoomMetrics | null>(null);
  const isGestureActiveRef = useRef(false);
  const decodedOriginalsRef = useRef(new Set<string>());
  const pendingOriginalRevealsRef = useRef(new Set<string>());
  const originalLoadPromisesRef = useRef(new Map<string, Promise<boolean>>());
  const prefetchedOriginalsRef = useRef(new Set<string>());
  const appliedOpenImageIdRef = useRef<string | null>(null);
  // pointermove는 연속 이벤트라 pointerup이 도착할 때까지 setState가 아직 커밋되지 않았을 수
  // 있다. 놓는 순간의 임계값 판정은 이 ref를 읽는다.
  const offsetRef = useRef(0);

  const [storedIndex, setStoredIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isGestureActive, setIsGestureActive] = useState(false);
  const [isChromeHidden, setIsChromeHidden] = useState(false);
  const [zoom, setZoom] = useState<ZoomState>(DEFAULT_ZOOM);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const [renderedOpenImageId, setRenderedOpenImageId] = useState<string | null>(
    null,
  );
  // 슬라이드는 현재 장에서 두 칸 멀어지면 언마운트된다. 이미 decode한 원본을 기억하지 않으면
  // 되돌아올 때마다 축소본으로 내려가므로, 이 기억은 뷰어가 소유한다.
  const [shownOriginals, setShownOriginals] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const markOriginalDecoded = useCallback((src: string) => {
    decodedOriginalsRef.current.add(src);
    if (isGestureActiveRef.current) {
      pendingOriginalRevealsRef.current.add(src);
      return;
    }

    setShownOriginals((current) =>
      current.has(src) ? current : new Set(current).add(src),
    );
  }, []);

  const revealDecodedOriginals = () => {
    if (pendingOriginalRevealsRef.current.size === 0) return;

    const pending = pendingOriginalRevealsRef.current;
    pendingOriginalRevealsRef.current = new Set();
    setShownOriginals((current) => {
      const next = new Set(current);
      pending.forEach((src) => next.add(src));
      return next;
    });
  };

  const preloadOriginal = useCallback((src: string): Promise<boolean> => {
    const existing = originalLoadPromisesRef.current.get(src);
    if (existing) return existing;

    const promise = new Promise<boolean>((resolve) => {
      const original = new Image();
      original.crossOrigin = "anonymous";
      original.onload = () => {
        if (typeof original.decode !== "function") {
          resolve(true);
          return;
        }

        try {
          void original.decode().then(
            () => resolve(true),
            () => resolve(false),
          );
        } catch {
          resolve(false);
        }
      };
      original.onerror = () => resolve(false);
      original.src = src;
    });
    originalLoadPromisesRef.current.set(src, promise);
    return promise;
  }, []);

  const writeTrackOffset = (value: number) => {
    trackRef.current?.style.setProperty(
      "--image-viewer-track-offset",
      `${value}px`,
    );
  };

  const writeZoom = (value: ZoomState) => {
    const image = imageRef.current;
    if (!image) return;

    image.style.setProperty("--image-viewer-zoom-x", `${value.x}px`);
    image.style.setProperty("--image-viewer-zoom-y", `${value.y}px`);
    image.style.setProperty("--image-viewer-zoom-scale", `${value.scale}`);
  };

  const flushPendingTransforms = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (pendingTrackOffsetRef.current !== null) {
      writeTrackOffset(pendingTrackOffsetRef.current);
      pendingTrackOffsetRef.current = null;
    }
    if (pendingZoomRef.current !== null) {
      writeZoom(pendingZoomRef.current);
      pendingZoomRef.current = null;
    }
  };

  const scheduleTransformFrame = () => {
    if (animationFrameRef.current !== null) return;

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      if (pendingTrackOffsetRef.current !== null) {
        writeTrackOffset(pendingTrackOffsetRef.current);
        pendingTrackOffsetRef.current = null;
      }
      if (pendingZoomRef.current !== null) {
        writeZoom(pendingZoomRef.current);
        pendingZoomRef.current = null;
      }
    });
  };

  const setDragOffset = (value: number) => {
    offsetRef.current = value;
    pendingTrackOffsetRef.current = value;
    scheduleTransformFrame();
  };

  const setDragOffsetImmediately = (value: number) => {
    offsetRef.current = value;
    pendingTrackOffsetRef.current = null;
    writeTrackOffset(value);
  };

  const setZoomState = (value: ZoomState) => {
    zoomRef.current = value;
    pendingZoomRef.current = value;
    scheduleTransformFrame();
  };

  const commitZoomState = (value: ZoomState) => {
    zoomRef.current = value;
    pendingZoomRef.current = null;
    writeZoom(value);
    setZoom(value);
  };

  const resetZoom = () => {
    zoomMetricsRef.current = null;
    commitZoomState(DEFAULT_ZOOM);
  };

  const setGestureActive = (active: boolean) => {
    isGestureActiveRef.current = active;
    setIsGestureActive(active);
  };

  useEffect(
    () => () => {
      if (pendingTapRef.current !== null) clearTimeout(pendingTapRef.current);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (openImageId === null) return;

    const root = document.documentElement;
    root.classList.add("image-viewer-open");
    return () => root.classList.remove("image-viewer-open");
  }, [openImageId]);

  // 데스크톱에서 좌우 방향키로 넘긴다. Popup의 onKeyDown을 쓰지 않는 이유는 이 뷰어가
  // 게시물 상세 dialog 위에 열려 포커스가 여기까지 오지 않기 때문이고, capture 단계인
  // 이유는 그 아래 dialog가 방향키를 먼저 삼켜 bubble까지 오지 않기 때문이다.
  const handleArrowKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    flushPendingTransforms();
    offsetRef.current = 0;
    pendingTrackOffsetRef.current = null;
    resetZoom();
    setStoredIndex((current) => {
      const clamped = Math.max(0, Math.min(current, images.length - 1));
      const next = event.key === "ArrowLeft" ? clamped - 1 : clamped + 1;
      return Math.max(0, Math.min(next, images.length - 1));
    });
  });

  useEffect(() => {
    if (openImageId === null) return;
    document.addEventListener("keydown", handleArrowKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleArrowKey, {
        capture: true,
      });
  }, [openImageId]);

  // 새로 열렸다: 열린 장으로 점프한다. 바깥에서 index를 움직이는 건 이것뿐이다.
  if (renderedOpenImageId !== openImageId) {
    setRenderedOpenImageId(openImageId);
    setStoredIndex(
      Math.max(
        0,
        images.findIndex((image) => image.id === openImageId),
      ),
    );
    setZoom(DEFAULT_ZOOM);
    setIsChromeHidden(false);
  }

  // 뷰어가 열려 있는 동안 첨부 목록이 바뀔 수 있다.
  const index = Math.max(0, Math.min(storedIndex, images.length - 1));
  const activeImage = images[index];

  useLayoutEffect(() => {
    if (!openImageId) return;

    if (appliedOpenImageIdRef.current !== openImageId) {
      appliedOpenImageIdRef.current = openImageId;
      offsetRef.current = 0;
      pendingTrackOffsetRef.current = null;
      zoomRef.current = DEFAULT_ZOOM;
      pendingZoomRef.current = null;
      zoomMetricsRef.current = null;
    }
    if (!isDragging) writeTrackOffset(0);
    writeZoom(zoomRef.current);
  }, [index, isDragging, openImageId]);

  useEffect(() => {
    if (!openImageId || !activeImage || !hasDistinctThumbnail(activeImage)) {
      return;
    }

    let cancelled = false;
    let adjacentPreloadTimer: number | null = null;

    const loadActiveAndPrefetch = async () => {
      const activeLoaded = await preloadOriginal(activeImage.src);
      if (cancelled) return;
      if (!activeLoaded) return;

      markOriginalDecoded(activeImage.src);
      if (isGestureActiveRef.current) return;

      // 열린 사진을 먼저 decode한 뒤에만 다음 후보 한 장을 낮은 우선순위로 준비한다.
      const adjacent = [images[index + 1], images[index - 1]].find(
        (image) =>
          image !== undefined &&
          hasDistinctThumbnail(image) &&
          !prefetchedOriginalsRef.current.has(image.src),
      );
      if (!adjacent) return;

      prefetchedOriginalsRef.current.add(adjacent.src);
      adjacentPreloadTimer = window.setTimeout(() => {
        if (isGestureActiveRef.current) return;
        void preloadOriginal(adjacent.src).then((loaded) => {
          if (!cancelled && loaded) markOriginalDecoded(adjacent.src);
        });
      }, 200);
    };

    void loadActiveAndPrefetch();
    return () => {
      cancelled = true;
      if (adjacentPreloadTimer !== null) {
        window.clearTimeout(adjacentPreloadTimer);
      }
    };
  }, [
    activeImage,
    images,
    index,
    markOriginalDecoded,
    openImageId,
    preloadOriginal,
  ]);

  if (!openImageId || !activeImage) return null;

  const getViewportWidth = () => viewportRef.current?.clientWidth ?? 0;

  const goTo = (nextIndex: number) => {
    flushPendingTransforms();
    offsetRef.current = 0;
    pendingTrackOffsetRef.current = null;
    if (nextIndex >= 0 && nextIndex < images.length) {
      resetZoom();
      setStoredIndex(nextIndex);
    }
  };

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

  const measureZoomMetrics = (): ZoomMetrics | null => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return null;

    const rect = viewport.getBoundingClientRect();
    const metrics = {
      viewportLeft: rect.left,
      viewportTop: rect.top,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      imageWidth: image.clientWidth,
      imageHeight: image.clientHeight,
    };
    zoomMetricsRef.current = metrics;
    return metrics;
  };

  const clampZoom = (next: ZoomState): ZoomState => {
    const scale = Math.max(1, Math.min(MAX_ZOOM, next.scale));
    if (scale === 1) return DEFAULT_ZOOM;

    const metrics = zoomMetricsRef.current ?? measureZoomMetrics();
    if (!metrics) return DEFAULT_ZOOM;

    const maxX = Math.max(
      0,
      (metrics.imageWidth * scale - metrics.viewportWidth) / 2,
    );
    const maxY = Math.max(
      0,
      (metrics.imageHeight * scale - metrics.viewportHeight) / 2,
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
    lastPointerTypeRef.current = event.pointerType;
    if (
      event.pointerType === "mouse" ||
      (event.target as HTMLElement).closest("button, a")
    ) {
      return;
    }

    const point = { x: event.clientX, y: event.clientY };
    activePointersRef.current.set(event.pointerId, point);

    if (activePointersRef.current.size === 2) {
      const pair = getPointerPair();
      if (!pair || pair.distance === 0) return;

      markDragged();
      gestureModeRef.current = "pinch";
      pinchStartRef.current = { ...pair, zoom: zoomRef.current };
      measureZoomMetrics();
      setDragOffsetImmediately(0);
      setIsDragging(false);
      setGestureActive(true);
      setIsChromeHidden(true);
      return;
    }

    if (activePointersRef.current.size > 1) {
      markDragged();
      return;
    }

    gestureStartRef.current = point;
    setGestureActive(true);

    if (zoomRef.current.scale > 1) {
      gestureModeRef.current = "pan";
      panBaseRef.current = { x: zoomRef.current.x, y: zoomRef.current.y };
      measureZoomMetrics();
      return;
    }

    const grabbedOffset = readRenderedOffset();

    gestureModeRef.current = "slide";
    dragBaseRef.current = grabbedOffset;
    hasDraggedRef.current = false;
    setDragOffsetImmediately(grabbedOffset);
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
      const metrics = zoomMetricsRef.current;
      if (!start || !pair || !metrics || start.distance === 0) return;

      event.preventDefault();
      const scale = Math.max(
        1,
        Math.min(MAX_ZOOM, start.zoom.scale * (pair.distance / start.distance)),
      );
      const viewportCenter = {
        x: metrics.viewportLeft + metrics.viewportWidth / 2,
        y: metrics.viewportTop + metrics.viewportHeight / 2,
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
    const wasDragging = hasDraggedRef.current;
    if (
      !wasDragging &&
      Math.hypot(distanceX, distanceY) <= DRAG_START_TOLERANCE
    ) {
      return;
    }

    // 손이 움직이는 동안 계속 갱신한다. 클릭 억제 창은 드래그를 시작한 시각이 아니라
    // 손을 뗀 시각을 기준으로 닫혀야 하기 때문이다.
    markDragged();

    // 세로로 밀기 시작했다면 슬라이드는 포기한다. 확대한 이미지를 끄는 pan은 세로로도
    // 움직여야 하므로 여기서 걸러 내면 안 된다.
    if (
      !wasDragging &&
      gestureModeRef.current === "slide" &&
      Math.abs(distanceX) <= Math.abs(distanceY)
    ) {
      gestureModeRef.current = null;
      return;
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

    const viewportWidth = getViewportWidth();
    // 첫 장과 마지막 장의 정지 offset을 현재 index 기준으로 환산한 값.
    const firstSlideOffset = index * viewportWidth;
    const lastSlideOffset = (index - (images.length - 1)) * viewportWidth;
    // 드래그로 인정하는 데 쓴 만큼은 빼고 민다. 그래야 문턱을 넘는 순간 이미지가 튀지 않는다.
    const draggedDistance =
      Math.sign(distanceX) *
      Math.max(0, Math.abs(distanceX) - DRAG_START_TOLERANCE);
    const draggedOffset = dragBaseRef.current + draggedDistance;

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
    flushPendingTransforms();

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
      commitZoomState(zoomRef.current);
      setGestureActive(false);
      revealDecodedOriginals();
      return;
    }

    if (activePointersRef.current.size > 0) return;

    const gestureMode = gestureModeRef.current;
    gestureModeRef.current = null;
    gestureStartRef.current = null;
    commitZoomState(zoomRef.current);
    setGestureActive(false);
    revealDecodedOriginals();
    setIsDragging(false);

    if (gestureMode === "pan") return;
    // 세로로 밀어 슬라이드를 포기한 경우. 정지 상태에서 잡았다면 0을 다시 쓰는 것뿐이지만,
    // 슬라이드 애니메이션 도중에 잡았다면 그 중간 지점이 offset에 남아 있다. 여기서 되돌리지
    // 않으면 트랙이 어긋난 자리에 그대로 멈춘다.
    if (gestureMode !== "slide") {
      offsetRef.current = 0;
      pendingTrackOffsetRef.current = null;
      return;
    }

    const viewportWidth = getViewportWidth();
    if (viewportWidth === 0) {
      offsetRef.current = 0;
      pendingTrackOffsetRef.current = null;
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
    if (lastPointerTypeRef.current !== "touch" || shouldSuppressClick()) {
      return;
    }

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
      commitZoomState(
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
            <DownloadControl
              activeImage={activeImage}
              images={images}
              allowDownloadAll={allowDownloadAll}
            />
            <Dialog.Close render={<ControlButton aria-label="닫기" />}>
              <XIcon className="size-5" />
            </Dialog.Close>
          </header>

          <div
            ref={viewportRef}
            data-testid="image-viewer-viewport"
            className="relative min-h-0 flex-1 touch-none overflow-hidden"
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
                transform: `translateX(calc(${-index * 100}% + var(--image-viewer-track-offset, 0px)))`,
                transition: isDragging ? "none" : SLIDE_TRANSITION,
              }}
            >
              {images.map((image, slideIndex) => (
                <Slide
                  key={image.id}
                  // 양옆 한 장씩만 그린다. 빈 슬롯도 트랙의 기하는 유지하므로 transform은 계속
                  // 100%의 정수배로 남고, 원본 decode는 활성 사진부터 별도로 순서를 둔다.
                  image={Math.abs(slideIndex - index) <= 1 ? image : undefined}
                  imageRef={slideIndex === index ? imageRef : undefined}
                  zoom={slideIndex === index ? zoom : undefined}
                  isGestureActive={isGestureActive}
                  showOriginal={shownOriginals.has(image.src)}
                  onBackdropClick={handleBackdropClick}
                  onImageClick={handleImageClick}
                />
              ))}
            </div>

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
            {images.length > 1 ? (
              <Filmstrip
                images={images}
                activeIndex={index}
                onSelect={goTo}
                testId="image-viewer-mobile-filmstrip"
                screen="mobile"
                className={cn(
                  "absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 to-transparent transition-opacity duration-150 sm:hidden",
                  isChromeHidden
                    ? "pointer-events-none opacity-0"
                    : "opacity-100",
                )}
              />
            ) : null}
          </div>

          {images.length > 1 ? (
            <Filmstrip
              images={images}
              activeIndex={index}
              onSelect={goTo}
              screen="desktop"
              className="hidden sm:block"
            />
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
