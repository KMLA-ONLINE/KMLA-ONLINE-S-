import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import { useScrollContainer } from "~/shared/lib/scroll-container";
import { cn } from "~/shared/lib/utils";

/** 접힌 본문 최대 높이(24px × 3줄, `.post-typography` 줄 높이에 묶임). 본문이 여러 블록이라 `line-clamp`를 쓰지 않는다. */
const COLLAPSED_BODY_HEIGHT = 72;

/**
 * 접힌 상자의 실제 높이. 제목은 줄 높이와 여백이 문단과 달라서 72px에서 그대로 자르면 줄이
 * 가로로 반쯤 잘려 보인다. 그 안에 온전히 들어가는 마지막 줄의 아래끝에서 자른다.
 */
function measureCollapsedHeight(node: HTMLElement): number {
  const range = document.createRange();
  // jsdom처럼 레이아웃이 없는 환경에는 Range의 줄 상자가 없다.
  if (typeof range.getClientRects !== "function") return COLLAPSED_BODY_HEIGHT;
  range.selectNodeContents(node);
  const top = node.getBoundingClientRect().top;
  let cut = 0;
  for (const rect of range.getClientRects()) {
    const bottom = rect.bottom - top;
    if (bottom <= COLLAPSED_BODY_HEIGHT + 0.5 && bottom > cut) cut = bottom;
  }
  return cut > 0
    ? Math.min(Math.ceil(cut), COLLAPSED_BODY_HEIGHT)
    : COLLAPSED_BODY_HEIGHT;
}

/**
 * 게시물별 접기 상태. 목록을 떠났다 돌아오면 카드가 다시 마운트되는데, 그때 펼친 글이 접히거나
 * "더 보기" 버튼이 측정 뒤에야 붙으면 목록 높이가 달라져 복원한 스크롤 위치가 어긋난다.
 */
const clampMemory = new Map<
  string,
  { expanded: boolean; clampable: boolean; collapsedHeight: number }
>();

/** 당겨서 새로고침은 새로 읽은 목록이라 펼쳐 둔 글을 모두 접는다. 화면에 남아 있는 카드도 이 세대 번호로 알아챈다. */
let collapseGeneration = 0;
const collapseListeners = new Set<() => void>();

export function collapseAllPostBodies() {
  clampMemory.forEach((entry, postId) =>
    clampMemory.set(postId, { ...entry, expanded: false }),
  );
  collapseGeneration += 1;
  collapseListeners.forEach((listener) => listener());
}

function subscribeCollapse(listener: () => void) {
  collapseListeners.add(listener);
  return () => collapseListeners.delete(listener);
}

function getCollapseGeneration() {
  return collapseGeneration;
}

/** 접을 때 카드 머리가 화면 위로 벗어나 있으면 머리가 보이는 자리로 되돌린다. 모바일 sticky 헤더 높이는 그때 잰다. */
function revealCardHead(body: HTMLElement, container: HTMLElement) {
  const card = body.closest("article") ?? body;
  const stickyHeader = container.querySelector<HTMLElement>("header.sticky");
  const visibleTop =
    container.getBoundingClientRect().top + (stickyHeader?.offsetHeight ?? 0);
  const overshoot = card.getBoundingClientRect().top - visibleTop;
  if (overshoot < 0) container.scrollTop += overshoot;
}

/** 피드 카드의 본문 접기. 실제로 잘렸을 때만 "더 보기"를 그린다. */
export function PostBodyClamp({
  postId,
  testId,
  children,
}: {
  /** 주면 펼침·잘림 상태를 다시 마운트돼도 이어 쓴다. */
  postId?: string;
  testId?: string;
  children: ReactNode;
}) {
  const [state, setState] = useState(
    () =>
      (postId ? clampMemory.get(postId) : undefined) ?? {
        expanded: false,
        clampable: false,
        collapsedHeight: COLLAPSED_BODY_HEIGHT,
      },
  );
  const { expanded, clampable, collapsedHeight } = state;
  const generation = useSyncExternalStore(
    subscribeCollapse,
    getCollapseGeneration,
    getCollapseGeneration,
  );
  const [seenGeneration, setSeenGeneration] = useState(generation);
  if (seenGeneration !== generation) {
    setSeenGeneration(generation);
    if (expanded) setState({ ...state, expanded: false });
  }
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useScrollContainer();

  const update = useCallback(
    (patch: Partial<typeof state>) =>
      setState((current) => {
        const next = { ...current, ...patch };
        if (
          next.expanded === current.expanded &&
          next.clampable === current.clampable &&
          next.collapsedHeight === current.collapsedHeight
        )
          return current;
        if (postId) clampMemory.set(postId, next);
        return next;
      }),
    [postId],
  );
  const setExpanded = (value: boolean) => update({ expanded: value });

  const measureBody = useCallback(
    (node: HTMLDivElement) => {
      bodyRef.current = node;
      // `scrollHeight`는 접혀 있어도 본문 전체 높이라 펼친 상태에서도 잴 수 있다. 글을 수정해
      // 본문이 바뀌면 상자 크기도 바뀌므로 그때마다 다시 잰다. 한 번만 재면 수정 전 판정이 남는다.
      const measure = () =>
        update({
          clampable: node.scrollHeight > COLLAPSED_BODY_HEIGHT,
          collapsedHeight: measureCollapsedHeight(node),
        });
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      // 접힌 상자는 높이가 고정이라 글꼴이 늦게 바뀌어 줄이 옮겨 가도 자기 크기는 그대로다.
      // 안쪽 본문의 크기 변화로 자를 자리를 다시 잰다.
      for (const child of node.children) observer.observe(child);
      return () => {
        observer.disconnect();
        bodyRef.current = null;
      };
    },
    [update],
  );

  const toggle = () => {
    if (!expanded) {
      setExpanded(true);
      return;
    }
    // 접힌 레이아웃을 먼저 그려야 카드가 어디로 밀려났는지 잴 수 있다. 같은 프레임에서
    // 스크롤까지 맞춰 화면이 한 번만 바뀐다.
    flushSync(() => setExpanded(false));
    const body = bodyRef.current;
    const container = scrollRef?.current;
    if (body && container) revealCardHead(body, container);
  };

  return (
    <>
      {/* 탭으로 펼치기는 포인터 전용 편의다. 키보드·낭독기는 아래 "더 보기" 버튼을 쓴다. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        data-testid={testId}
        ref={measureBody}
        onClick={(event) => {
          if (!window.matchMedia("(pointer: coarse)").matches) return;
          if ((event.target as Element).closest("a, button")) return;
          if (clampable) toggle();
        }}
        style={expanded ? undefined : { maxHeight: collapsedHeight }}
        className={cn(
          !expanded && "overflow-hidden",
          // 터치 기기에서는 본문을 탭해도 펼쳐진다. 마우스에서는 버튼만 반응한다 —
          // 본문의 텍스트를 드래그해 선택하는 동작과 부딪히기 때문이다.
          clampable && "pointer-coarse:cursor-pointer",
        )}
      >
        {children}
      </div>
      {clampable ? (
        <button
          type="button"
          onClick={toggle}
          className="mt-0.5 text-sm font-medium text-muted-foreground hover:underline pointer-fine:font-semibold pointer-fine:text-foreground"
        >
          {expanded ? "접기" : "더 보기"}
        </button>
      ) : null}
    </>
  );
}
