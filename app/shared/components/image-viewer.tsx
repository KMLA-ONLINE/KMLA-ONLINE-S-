import { Dialog } from "@base-ui/react/dialog";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ImageOffIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
  type SyntheticEvent,
} from "react";

import {
  PAGE_GAP,
  ViewerMotion,
  ZOOM_STEP,
  useViewerGestures,
  type ViewerLayout,
} from "~/shared/components/image-viewer-gestures";
import {
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  clamp,
  clampZoom,
  fitSize,
  type Point,
  type Size,
} from "~/shared/lib/image-viewer-geometry";
import { cn } from "~/shared/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Spinner } from "~/shared/ui/spinner";

export interface ViewerImage {
  id: string;
  /** 화면에 그릴 URL. 크게 보는 자리라 언제나 원본이다. */
  src: string;
  /**
   * 원본보다 먼저 띄울 축소본이자 하단 썸네일 목록이 그릴 URL. 없으면 `src`로 떨어진다.
   *
   * 그 목록은 **묶음의 모든 이미지**를 한 번에 그린다. 사진 열 장짜리 게시물을 열면 56px 칸 열 개를
   * 채우려고 원본 열 장을 받게 된다.
   */
  thumbSrc?: string;
  /** 저장 버튼이 쓸 URL. 같은 파일이지만 서버가 첨부로 내려주는 주소다. */
  downloadSrc: string;
  /** alt text이자 스크린리더 제목, 저장 파일 이름. */
  name: string;
  /**
   * 원본의 픽셀 치수. 알면 불러오기 전에 자리를 잡아 둔다. 모르면 먼저 도착한 이미지에서 잰다.
   * 축소본이 원본으로 바뀔 때 크기가 튀지 않게 하는 것이 이 값이다.
   */
  width?: number;
  height?: number;
}

/**
 * decode까지 마친 원본. 슬라이드는 현재 장에서 두 칸 멀어지면 언마운트되고 뷰어는 닫힐 때마다
 * 새로 마운트되므로, 되돌아왔을 때 축소본으로 내려가지 않으려면 컴포넌트 밖에서 기억해야 한다.
 */
const shownOriginals = new Set<string>();

const CONTROL_CLASS =
  "pointer-events-auto flex size-10 shrink-0 items-center justify-center rounded-full text-white/85 transition hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35";

const NAV_CLASS =
  "absolute top-1/2 hidden size-12 -translate-y-1/2 bg-black/45 backdrop-blur-sm hover:bg-black/65 disabled:invisible sm:flex";

interface NaturalSize extends Size {
  /** 축소본에서 잰 값이다. 비율만 믿을 수 있고 크기는 원본보다 작다. */
  fromThumb: boolean;
}

interface StageBox {
  viewport: Size;
  origin: Point;
  /** 1배 이미지를 놓는 영역. 넓은 화면에서 조작부 자리를 뺀 뷰포트다. */
  stage: { left: number; top: number; width: number; height: number };
}

function measureStage(element: HTMLElement): StageBox {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const px = (value: string) => Number.parseFloat(value) || 0;
  const left = px(style.paddingLeft);
  const top = px(style.paddingTop);

  return {
    viewport: { width: rect.width, height: rect.height },
    origin: { x: rect.left, y: rect.top },
    stage: {
      left,
      top,
      width: Math.max(0, rect.width - left - px(style.paddingRight)),
      height: Math.max(0, rect.height - top - px(style.paddingBottom)),
    },
  };
}

function sameStageBox(left: StageBox, right: StageBox): boolean {
  return (
    left.viewport.width === right.viewport.width &&
    left.viewport.height === right.viewport.height &&
    left.origin.x === right.origin.x &&
    left.origin.y === right.origin.y &&
    left.stage.left === right.stage.left &&
    left.stage.top === right.stage.top &&
    left.stage.width === right.stage.width &&
    left.stage.height === right.stage.height
  );
}

/** 1배일 때의 이미지 크기. 원본보다 크게 늘리지 않는다 — 작은 사진을 키우면 흐려 보인다. */
function frameSizeFor(
  image: ViewerImage,
  natural: NaturalSize | undefined,
  stage: Size,
): Size {
  if (image.width && image.height) {
    return fitSize({ width: image.width, height: image.height }, stage);
  }
  if (!natural) return { width: 0, height: 0 };
  return fitSize(natural, stage, natural.fromThumb ? Infinity : 1);
}

function hasDistinctThumbnail(image: ViewerImage): boolean {
  return Boolean(image.thumbSrc && image.thumbSrc !== image.src);
}

/**
 * 뷰어가 전체화면(안드로이드의 하단 탐색 바까지 숨기는 몰입 모드)에 들어갔다면 빠져나온다.
 * 사용자나 시스템이 먼저 빠져나왔다면 아무것도 하지 않는다.
 */
function leaveImmersive(entered: RefObject<boolean>) {
  if (!entered.current) return;
  entered.current = false;
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
}

/**
 * 모든 사진을 차례로 내려받는다. 숨긴 iframe은 첨부로 내려오는 응답을 받아도 화면을 떠나지
 * 않고, 팝업 차단에도 걸리지 않는다. 한 번에 몰아 요청하면 브라우저가 뒤의 것을 버리므로 간격을
 * 둔다. 여러 파일 다운로드를 허용할지는 브라우저가 따로 묻는다.
 */
function downloadEach(images: ViewerImage[]) {
  images.forEach((image, order) => {
    window.setTimeout(() => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.src = image.downloadSrc;
      document.body.append(frame);
      window.setTimeout(() => frame.remove(), 60_000);
    }, order * 400);
  });
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

function DownloadControl({
  image,
  images,
  downloadAll,
}: {
  image: ViewerImage;
  images: ViewerImage[];
  downloadAll: boolean;
}) {
  if (!downloadAll || images.length < 2) {
    return (
      <a
        href={image.downloadSrc}
        download={image.name}
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
      <DropdownMenuTrigger render={<ControlButton aria-label="다운로드" />}>
        <DownloadIcon className="size-5" />
      </DropdownMenuTrigger>
      {/* 뷰어가 z-60이라 메뉴는 그보다 위에 떠야 한다. */}
      <DropdownMenuContent
        align="end"
        positionerClassName="z-70"
        className="min-w-48"
      >
        <DropdownMenuItem
          render={
            // 내용은 Menu.Item이 children으로 채운다.
            // eslint-disable-next-line jsx-a11y/anchor-has-content
            <a
              href={image.downloadSrc}
              download={image.name}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          현재 사진 다운로드
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadEach(images)}>
          모든 사진 다운로드 ({images.length}장)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Filmstrip({
  images,
  activeIndex,
  hidden,
  onSelect,
}: {
  images: ViewerImage[];
  activeIndex: number;
  hidden: boolean;
  onSelect: (index: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeThumbnailRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const thumbnail = activeThumbnailRef.current;
    if (!scroller || !thumbnail) return;

    // `scrollIntoView`는 스크롤 조상을 전부 훑어 뷰어 자체까지 밀 수 있다. 이 목록 안에서만 민다.
    const scrollerRect = scroller.getBoundingClientRect();
    const thumbnailRect = thumbnail.getBoundingClientRect();
    if (
      thumbnailRect.left >= scrollerRect.left &&
      thumbnailRect.right <= scrollerRect.right
    ) {
      return;
    }
    scroller.scrollTo({
      left:
        scroller.scrollLeft +
        thumbnailRect.left -
        scrollerRect.left -
        (scrollerRect.width - thumbnailRect.width) / 2,
      behavior: "smooth",
    });
  }, [activeIndex]);

  return (
    <div
      inert={hidden}
      className={cn(
        "absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent transition-opacity duration-200",
        hidden && "opacity-0",
      )}
    >
      <div
        ref={scrollerRef}
        data-testid="image-viewer-filmstrip"
        className="pointer-events-auto scrollbar-none overflow-x-auto overscroll-x-contain"
      >
        <div className="mx-auto flex w-max gap-2 px-3 pt-6 pb-[calc(0.75rem+var(--app-safe-b))]">
          {images.map((image, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={image.id}
                ref={isActive ? activeThumbnailRef : undefined}
                type="button"
                aria-label={`${index + 1}번째 이미지`}
                aria-current={isActive}
                onClick={() => onSelect(index)}
                className={cn(
                  "size-14 shrink-0 overflow-hidden rounded-lg ring-2 transition focus-visible:ring-white focus-visible:outline-none",
                  isActive
                    ? "opacity-100 ring-white"
                    : "opacity-55 ring-transparent hover:opacity-90",
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
    </div>
  );
}

/**
 * 한 장. 축소본을 먼저 깔고, 원본은 decode까지 끝난 뒤 그 위로 겹쳐 올린다. 둘은 같은 틀을
 * 가득 채우므로 바뀌는 순간 크기도 자리도 그대로다.
 */
function Slide({
  image,
  isActive,
  left,
  width,
  frame,
  stage,
  zoomed,
  frameRef,
  slideRef,
  onNaturalSize,
}: {
  image: ViewerImage;
  isActive: boolean;
  left: number;
  width: number;
  frame: Size;
  stage: StageBox["stage"];
  zoomed: boolean;
  frameRef: (element: HTMLDivElement | null) => void;
  slideRef: (element: HTMLDivElement | null) => void;
  onNaturalSize: (id: string, size: NaturalSize) => void;
}) {
  const hasThumb = hasDistinctThumbnail(image);
  const [originalShown, setOriginalShown] = useState(() =>
    shownOriginals.has(image.src),
  );
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [originalFailed, setOriginalFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  const failed = originalFailed && (!hasThumb || thumbFailed);
  const loading = !failed && !originalShown && !thumbLoaded;

  const reportSize = (element: HTMLImageElement, fromThumb: boolean) => {
    if (image.width && image.height) return;
    if (element.naturalWidth === 0 || element.naturalHeight === 0) return;
    onNaturalSize(image.id, {
      width: element.naturalWidth,
      height: element.naturalHeight,
      fromThumb,
    });
  };

  const handleOriginalLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget;
    reportSize(element, false);
    const reveal = () => {
      shownOriginals.add(image.src);
      setOriginalShown(true);
    };
    // decode 전에 올리면 큰 원본을 그리는 동안 한 프레임이 멈춘다.
    if (typeof element.decode === "function") {
      element.decode().then(reveal, reveal);
    } else {
      reveal();
    }
  };

  const frameLeft = stage.left + (stage.width - frame.width) / 2;
  const frameTop = stage.top + (stage.height - frame.height) / 2;

  return (
    <div
      ref={slideRef}
      data-testid={isActive ? "image-viewer-active-slide" : undefined}
      className="absolute inset-y-0"
      style={{ left, width }}
    >
      {loading || failed ? (
        <div
          className="absolute flex items-center justify-center text-white/70"
          style={{
            left: stage.left,
            top: stage.top,
            width: stage.width,
            height: stage.height,
          }}
        >
          {failed ? (
            <div className="flex flex-col items-center gap-2 text-sm">
              <ImageOffIcon className="size-8" />
              이미지를 불러오지 못했습니다
            </div>
          ) : (
            // 금방 뜨는 사진에서 스피너가 번쩍이지 않게 잠깐 기다렸다 보인다.
            <Spinner className="size-7 animate-in fade-in-0 [--tw-animation-delay:400ms] [--tw-animation-fill-mode:backwards]" />
          )}
        </div>
      ) : null}
      <div
        ref={frameRef}
        data-testid={isActive ? "image-viewer-frame" : undefined}
        className={cn(
          "absolute will-change-transform",
          (frame.width === 0 || failed) && "invisible",
          isActive &&
            (zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"),
        )}
        style={{
          left: frameLeft,
          top: frameTop,
          width: frame.width,
          height: frame.height,
        }}
      >
        {hasThumb ? (
          <img
            src={image.thumbSrc}
            alt=""
            crossOrigin="anonymous"
            draggable={false}
            className="absolute inset-0 size-full"
            onLoad={(event) => {
              reportSize(event.currentTarget, true);
              setThumbLoaded(true);
            }}
            onError={() => setThumbFailed(true)}
          />
        ) : null}
        <img
          src={image.src}
          alt={image.name}
          crossOrigin="anonymous"
          draggable={false}
          fetchPriority={isActive ? "high" : "low"}
          data-shown={originalShown || !hasThumb || undefined}
          className={cn(
            "absolute inset-0 size-full transition-opacity duration-150",
            hasThumb && !originalShown && "opacity-0",
          )}
          onLoad={handleOriginalLoad}
          onError={() => setOriginalFailed(true)}
        />
      </div>
    </div>
  );
}

function ViewerContent({
  images,
  initialImageId,
  open,
  downloadAll,
  backdropRef,
  onClose,
}: {
  images: ViewerImage[];
  initialImageId: string;
  open: boolean;
  downloadAll: boolean;
  backdropRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const frameElements = useRef(new Map<string, HTMLDivElement>());
  const slideElements = useRef(new Map<string, HTMLDivElement>());
  const motion = useRef(new ViewerMotion());
  const layoutRef = useRef<ViewerLayout | null>(null);
  const animateNextPageRef = useRef(false);
  const chromeVisibleRef = useRef(true);
  const immersiveRef = useRef(false);

  const [storedIndex, setStoredIndex] = useState(() =>
    Math.max(
      0,
      images.findIndex((image) => image.id === initialImageId),
    ),
  );
  const [chromeVisible, setChromeVisible] = useState(true);
  const [zoomScale, setZoomScale] = useState(MIN_ZOOM);
  const [box, setBox] = useState<StageBox | null>(null);
  const [naturalSizes, setNaturalSizes] = useState<Record<string, NaturalSize>>(
    {},
  );

  // 뷰어가 열려 있는 동안 첨부 목록이 줄어들 수 있다.
  const index = clamp(storedIndex, 0, images.length - 1);
  const activeImage = images[index];
  const activeId = activeImage?.id;
  const pageWidth = box ? box.viewport.width + PAGE_GAP : 0;
  const stageSize: Size = box
    ? { width: box.stage.width, height: box.stage.height }
    : { width: 0, height: 0 };
  const { width: frameWidth, height: frameHeight } = activeImage
    ? frameSizeFor(activeImage, naturalSizes[activeImage.id], stageSize)
    : stageSize;

  const showChrome = (visible: boolean) => {
    chromeVisibleRef.current = visible;
    setChromeVisible(visible);
  };

  /**
   * 터치 기기에서 조작부를 숨길 때 전체화면에도 들어간다. 안드로이드는 그래야 하단 탐색 바가
   * 사라진다. 요청은 사용자 제스처 안에서만 받아 주므로 탭 처리에서 곧바로 부른다. iPhone처럼
   * 요소 전체화면이 없는 곳에서는 조작부만 숨긴다.
   */
  const enterImmersive = () => {
    const root = document.documentElement;
    if (
      immersiveRef.current ||
      document.fullscreenElement ||
      !document.fullscreenEnabled ||
      typeof root.requestFullscreen !== "function"
    ) {
      return;
    }
    immersiveRef.current = true;
    root.requestFullscreen({ navigationUI: "hide" }).catch(() => {
      immersiveRef.current = false;
    });
  };

  const goTo = (next: number) => {
    if (next < 0 || next >= images.length || next === index) return;
    // 이웃한 장은 미끄러져 가고, 목록에서 멀리 건너뛸 때는 곧바로 바뀐다.
    animateNextPageRef.current = Math.abs(next - index) === 1;
    setStoredIndex(next);
    setZoomScale(MIN_ZOOM);
  };

  const gestures = useViewerGestures({
    motion,
    viewport: viewportRef,
    getLayout: () => layoutRef.current,
    canPage: (direction) =>
      index + direction >= 0 && index + direction < images.length,
    onPage: (direction) => goTo(index + direction),
    onTap: () => {
      const next = !chromeVisibleRef.current;
      showChrome(next);
      if (next) leaveImmersive(immersiveRef);
      else enterImmersive();
    },
    onDismiss: onClose,
    onZoomChange: (zoom) => setZoomScale(zoom.scale),
    // 확대하는 동안에는 전체화면을 바꾸지 않는다. 화면 크기가 바뀌면 손가락 아래의 이미지가 움직인다.
    onZoomGesture: () => showChrome(false),
  });

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;

    const update = () =>
      setBox((current) => {
        const next = measureStage(element);
        return current && sameStageBox(current, next) ? current : next;
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    motion.current.reducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);

  // 장이 바뀌면 트랙을 새 자리로 보내고, 확대·끌기 대상을 새 장의 요소로 바꾼다.
  useLayoutEffect(() => {
    const current = motion.current;
    current.track = trackRef.current;
    current.chrome = chromeRef.current;
    current.backdrop = backdropRef.current;
    current.index = index;
    current.pageWidth = pageWidth;

    const frame = activeId
      ? (frameElements.current.get(activeId) ?? null)
      : null;
    if (current.frame !== frame) {
      if (current.frame) current.releaseFrame(current.frame);
      current.frame = frame;
      current.slide = activeId
        ? (slideElements.current.get(activeId) ?? null)
        : null;
      current.zoom = IDENTITY;
      current.dismiss = { x: 0, y: 0 };
    }

    const animate = animateNextPageRef.current;
    animateNextPageRef.current = false;
    current.restTrack(animate);
  }, [activeId, backdropRef, index, pageWidth]);

  // 화면 크기나 이미지 치수가 바뀌면 확대 범위를 다시 잰다. 옛 범위가 남으면 가장자리에 빈 바탕이 드러난다.
  useLayoutEffect(() => {
    if (!box || frameWidth === 0) {
      layoutRef.current = null;
      return;
    }
    const layout: ViewerLayout = {
      viewport: box.viewport,
      origin: box.origin,
      center: {
        x: box.stage.left + box.stage.width / 2,
        y: box.stage.top + box.stage.height / 2,
      },
      frame: { width: frameWidth, height: frameHeight },
    };
    layoutRef.current = layout;

    const current = motion.current;
    if (current.zoom.scale > MIN_ZOOM) {
      current.setZoom(clampZoom(current.zoom, layout));
    }
  }, [box, frameHeight, frameWidth]);

  useEffect(() => {
    if (!open) leaveImmersive(immersiveRef);
  }, [open]);

  useEffect(() => () => leaveImmersive(immersiveRef), []);

  // 뒤로가기 제스처나 시스템이 전체화면을 먼저 끝냈다면 숨겨 둔 조작부도 되돌린다.
  const handleFullscreenChange = useEffectEvent(() => {
    if (document.fullscreenElement || !immersiveRef.current) return;
    immersiveRef.current = false;
    showChrome(true);
  });

  useEffect(() => {
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Popup의 onKeyDown을 쓰지 않는 이유는 이 뷰어가 게시물 상세 dialog 위에 열려 포커스가
  // 여기까지 오지 않을 수 있기 때문이고, capture 단계인 이유는 그 아래 dialog가 방향키를 먼저
  // 삼켜 bubble까지 오지 않기 때문이다.
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    // 다운로드 메뉴가 열려 있으면 방향키는 메뉴 항목을 옮긴다.
    if ((event.target as Element | null)?.closest?.('[role="menu"]')) return;

    switch (event.key) {
      case "ArrowLeft":
        goTo(index - 1);
        break;
      case "ArrowRight":
        goTo(index + 1);
        break;
      case "+":
      case "=":
        gestures.zoomBy(ZOOM_STEP);
        break;
      case "-":
        gestures.zoomBy(1 / ZOOM_STEP);
        break;
      case "0":
        gestures.resetZoom();
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [open]);

  if (!activeImage) return null;

  const hasMany = images.length > 1;
  const chromeHidden = !chromeVisible;

  return (
    <>
      <Dialog.Title className="sr-only">{activeImage.name}</Dialog.Title>

      <div
        ref={viewportRef}
        data-testid="image-viewer-viewport"
        className="absolute inset-0 touch-none overflow-hidden"
        {...gestures.handlers}
        onPointerMove={(event) => {
          // 터치로 숨긴 조작부는 마우스를 움직이면 돌아온다. 마우스로는 숨길 방법이 없다.
          if (event.pointerType === "mouse" && !chromeVisibleRef.current) {
            showChrome(true);
          }
          gestures.handlers.onPointerMove(event);
        }}
      >
        {/* 1배 이미지를 놓을 자리를 재는 용도. 넓은 화면은 조작부와 겹치지 않게 안쪽으로 들인다. */}
        <div
          ref={stageRef}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 sm:px-20 sm:pt-16",
            hasMany ? "sm:pb-[calc(6rem+var(--app-safe-b))]" : "sm:pb-16",
          )}
        />
        <div
          ref={trackRef}
          data-testid="image-viewer-track"
          className="absolute inset-0 will-change-transform"
        >
          {images.map((image, slideIndex) =>
            // 양옆 한 장씩만 그린다. 넘기는 동안 보일 수 있는 것은 그뿐이다.
            box && Math.abs(slideIndex - index) <= 1 ? (
              <Slide
                key={image.id}
                image={image}
                isActive={slideIndex === index}
                left={slideIndex * pageWidth}
                width={box.viewport.width}
                frame={frameSizeFor(image, naturalSizes[image.id], stageSize)}
                stage={box.stage}
                zoomed={slideIndex === index && zoomScale > MIN_ZOOM}
                frameRef={(element) => {
                  if (element) frameElements.current.set(image.id, element);
                  else frameElements.current.delete(image.id);
                }}
                slideRef={(element) => {
                  if (element) slideElements.current.set(image.id, element);
                  else slideElements.current.delete(image.id);
                }}
                onNaturalSize={(id, size) =>
                  setNaturalSizes((current) => {
                    const known = current[id];
                    // 원본에서 잰 값이 있으면 축소본 값으로 덮지 않는다.
                    if (known && (!known.fromThumb || size.fromThumb)) {
                      return current;
                    }
                    return { ...current, [id]: size };
                  })
                }
              />
            ) : null,
          )}
        </div>
      </div>

      {/* 조작부는 이미지 위에 겹친다. 숨기고 보여도 이미지 자리는 그대로라 화면이 흔들리지 않는다. */}
      <div
        ref={chromeRef}
        data-testid="image-viewer-chrome"
        data-hidden={chromeHidden || undefined}
        className="pointer-events-none absolute inset-0"
      >
        <header
          inert={chromeHidden}
          className={cn(
            "absolute inset-x-0 top-0 flex items-center gap-1 bg-linear-to-b from-black/60 to-transparent pt-[max(0.5rem,var(--app-safe-t))] pr-[max(0.5rem,var(--app-safe-r))] pb-6 pl-[max(0.5rem,var(--app-safe-l))] transition-opacity duration-200 sm:bg-none sm:pb-2 md:px-4 md:pt-3",
            chromeHidden && "opacity-0",
          )}
        >
          <p className="min-w-0 flex-1 px-3 text-sm text-white/80 tabular-nums">
            {hasMany ? `${index + 1} / ${images.length}` : null}
          </p>
          <ControlButton
            aria-label="축소"
            disabled={zoomScale <= MIN_ZOOM}
            onClick={() => gestures.zoomBy(1 / ZOOM_STEP)}
            className="max-sm:hidden"
          >
            <ZoomOutIcon className="size-5" />
          </ControlButton>
          <ControlButton
            aria-label="확대"
            disabled={zoomScale >= MAX_ZOOM}
            onClick={() => gestures.zoomBy(ZOOM_STEP)}
            className="max-sm:hidden"
          >
            <ZoomInIcon className="size-5" />
          </ControlButton>
          <DownloadControl
            image={activeImage}
            images={images}
            downloadAll={downloadAll}
          />
          <Dialog.Close render={<ControlButton aria-label="닫기" />}>
            <XIcon className="size-5" />
          </Dialog.Close>
        </header>

        {hasMany ? (
          <div
            inert={chromeHidden}
            className={cn(
              "transition-opacity duration-200",
              chromeHidden && "opacity-0",
            )}
          >
            <ControlButton
              aria-label="이전 이미지"
              disabled={index === 0}
              // 누른 뒤 포커스 링이 버튼에 남지 않게 한다. 키보드 사용자는 방향키가 있다.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => goTo(index - 1)}
              className={cn(NAV_CLASS, "left-4")}
            >
              <ChevronLeftIcon className="size-7" />
            </ControlButton>
            <ControlButton
              aria-label="다음 이미지"
              disabled={index === images.length - 1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => goTo(index + 1)}
              className={cn(NAV_CLASS, "right-4")}
            >
              <ChevronRightIcon className="size-7" />
            </ControlButton>
          </div>
        ) : null}

        {hasMany ? (
          <Filmstrip
            images={images}
            activeIndex={index}
            hidden={chromeHidden}
            onSelect={goTo}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * 전체화면 이미지 뷰어.
 *
 * `openImageId`는 "열렸는가, 어느 장에서 열었는가"만 답한다. 일부러 "현재 이미지"를 controlled로
 * 두지 않았다 — 한 장 넘길 때마다 router를 왕복시키면 드래그 도중에 비동기 왕복이 끼어들고,
 * 뒤늦게 도착한 prop이 손가락과 싸운다. 열린 뒤 어느 장을 보고 있는지는 뷰어가 소유한다.
 *
 * 닫히는 애니메이션 동안에는 호출부가 이미 묶음을 내려놓았을 수 있어, 마지막으로 연 묶음을
 * 직접 들고 있다가 애니메이션이 끝나면 버린다.
 */
export function ImageViewer({
  images,
  openImageId,
  downloadAll = false,
  onClose,
}: {
  images: ViewerImage[];
  openImageId: string | null;
  /** 다운로드 버튼에 "모든 사진" 항목을 둔다. 게시물 첨부처럼 한 묶음으로 올린 사진에만 켠다. */
  downloadAll?: boolean;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const open =
    openImageId !== null && images.some((image) => image.id === openImageId);
  const [session, setSession] = useState<{
    images: ViewerImage[];
    openImageId: string;
    downloadAll: boolean;
  } | null>(null);

  if (
    openImageId !== null &&
    open &&
    (session?.images !== images ||
      session.openImageId !== openImageId ||
      session.downloadAll !== downloadAll)
  ) {
    setSession({ images, openImageId, downloadAll });
  }

  // 열리자마자 닫히면(화면을 떠나는 렌더 한 번 동안만 `?image=`가 맞아떨어진 경우) Base UI가
  // 닫힘 완료를 알리지 못하고 멈춘다. 애니메이션보다 넉넉히 기다린 뒤에는 직접 내린다.
  useEffect(() => {
    if (open || !session) return;
    const timer = window.setTimeout(() => setSession(null), 500);
    return () => window.clearTimeout(timer);
  }, [open, session]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("image-viewer-open");
    return () => root.classList.remove("image-viewer-open");
  }, [open]);

  if (!session) return null;

  return (
    /* Base UI의 스크롤 잠금은 중첩 dialog에서 폭 보정이 겹치므로 사용하지 않는다. 대신
       뷰어가 열린 동안 루트에 image-viewer-open을 붙여 스크롤과 스크롤바만 직접 막는다. */
    <Dialog.Root
      open={open}
      modal="trap-focus"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) setSession(null);
      }}
    >
      <Dialog.Portal>
        {/* `forceRender` 없이는 Base UI가 중첩 dialog의 백드롭을 건너뛰어, 게시물 상세 안에서 옅은 부모 백드롭만 남는다. 아래 dialog도 `z-50`이라 한 단 올린다. */}
        <Dialog.Backdrop
          ref={backdropRef}
          forceRender
          className="fixed inset-0 z-60 bg-black duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <Dialog.Popup
          // 열자마자 닫기/다운로드 버튼에 포커스 링이 박히지 않게 popup 자신으로 보낸다.
          ref={popupRef}
          initialFocus={popupRef}
          className="fixed inset-0 z-60 overflow-hidden duration-200 outline-none select-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <ViewerContent
            key={session.openImageId}
            images={session.images}
            initialImageId={session.openImageId}
            open={open}
            downloadAll={session.downloadAll}
            backdropRef={backdropRef}
            onClose={onClose}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
