import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, EyeIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import {
  REACTION_TYPES,
  reactionAssetPath,
} from "~/features/posts/model/reactions";
import type { PostReaction } from "~/features/posts/model/types";
import { storyKeys } from "~/features/stories/data/cache";
import {
  isStoryLimitError,
  sendStoryReaction,
} from "~/features/stories/data/mutations";
import {
  listStoryViewers,
  type StoryViewerEntry,
} from "~/features/stories/data/queries";
import { RelativeTime } from "~/shared/components/relative-time";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 누른 반응이 버튼 위로 떠오르는 시간. */
const FLOAT_MS = 900;

/**
 * 마지막으로 누른 뒤 스토리를 이만큼 더 붙잡아 둔다. 연달아 누르는 사이에 다음 장으로 넘어가면
 * 반응이 엉뚱한 장에 간다.
 */
const REACTING_HOLD_MS = 1_500;

/**
 * 반응 그림을 미리 받아 둔다. 뷰어를 처음 열 때 받기 시작하면 반응 줄이 한 박자 늦게 뜬다.
 * 레일이 그려질 때 한 번 부른다.
 */
export function preloadStoryReactions() {
  for (const type of REACTION_TYPES) {
    const image = new Image();
    image.src = reactionAssetPath(type.key);
  }
}

/**
 * 다른 사람의 스토리 아래에 까는 반응 줄. 누를 때마다 하나씩 보내고(기능 명세 §17.6), 보냈다는
 * 표시로 그 반응이 떠올랐다 사라진다. 실패만 알린다. 성공을 매번 알리면 연타할 때 알림이 쌓인다.
 *
 * 누르는 동안과 마지막으로 누른 뒤 잠깐은 `onActiveChange(true)`로 스토리를 멈추게 한다. 줄의
 * 빈 곳은 터치를 받지 않아 그 아래 링크를 그대로 누를 수 있다.
 */
// 장마다 새로 그리지 않는다. 넘길 때마다 그림을 다시 붙이면 줄이 깜박이며 늦게 뜬다. 떠오르던
// 반응은 다음 장으로 넘어가도 끝까지 날아간다.
export function StoryReactionBar({
  storyId,
  onActiveChange,
}: {
  storyId: number;
  onActiveChange: (active: boolean) => void;
}) {
  const [floating, setFloating] = useState<
    { key: number; reaction: PostReaction; left: number }[]
  >([]);
  const nextKeyRef = useRef(0);
  const holdTimerRef = useRef<number | null>(null);
  const onActiveChangeRef = useRef(onActiveChange);

  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  });

  function hold() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    onActiveChangeRef.current(true);
  }

  function release() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      onActiveChangeRef.current(false);
    }, REACTING_HOLD_MS);
  }

  // 장이 바뀌어 줄이 사라지면 붙잡아 둔 것을 놓는다.
  useEffect(
    () => () => {
      if (holdTimerRef.current === null) return;
      window.clearTimeout(holdTimerRef.current);
      onActiveChangeRef.current(false);
    },
    [],
  );

  function send(reaction: PostReaction, index: number) {
    hold();
    release();
    sendStoryReaction(storyId, reaction).catch((error: unknown) => {
      toast.error(
        isStoryLimitError(error)
          ? "이 스토리에 보낼 수 있는 반응을 모두 보냈습니다."
          : "반응을 보내지 못했습니다.",
      );
    });

    const key = nextKeyRef.current++;
    setFloating((items) => [
      ...items,
      {
        key,
        reaction,
        left: ((index + 0.5) / REACTION_TYPES.length) * 100,
      },
    ]);
  }

  function land(key: number) {
    setFloating((items) => items.filter((item) => item.key !== key));
  }

  return (
    <div
      className="relative mx-auto flex w-fit gap-1"
      onPointerDown={hold}
      onPointerUp={release}
      onPointerCancel={release}
      // 마우스로 누른 채 밖으로 끌어 놓으면 이 줄에는 pointerup이 오지 않는다. 그러면 스토리가
      // 계속 멈춰 있으므로 벗어날 때도 놓아 준다.
      onPointerLeave={release}
    >
      {REACTION_TYPES.map((type, index) => (
        <button
          key={type.key}
          type="button"
          aria-label={`${type.label} 보내기`}
          onClick={() => send(type.key, index)}
          className="pointer-events-auto flex size-11 items-center justify-center rounded-full text-[1.75rem] transition-transform outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-125"
        >
          <ReactionEmoji reaction={type.key} />
        </button>
      ))}
      {floating.map((item) => (
        <FloatingReaction
          key={item.key}
          reaction={item.reaction}
          left={item.left}
          onLand={() => land(item.key)}
        />
      ))}
    </div>
  );
}

/**
 * 보낸 반응 하나가 떠오르는 모양. 처음 그려질 때 한 번만 움직인다. 움직임 줄이기면 제자리에서
 * 잠깐 보였다 사라진다. 아무 변화가 없으면 안 눌린 줄 알고 또 누른다.
 */
function FloatingReaction({
  reaction,
  left,
  onLand,
}: {
  reaction: PostReaction;
  left: number;
  onLand: () => void;
}) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const onLandRef = useRef(onLand);

  useEffect(() => {
    onLandRef.current = onLand;
  });

  useEffect(() => {
    const element = elementRef.current;

    if (!element || typeof element.animate !== "function") {
      onLandRef.current();
      return;
    }

    const reduced = window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
    const animation = element.animate(
      reduced
        ? [
            { transform: "translate(-50%, -3rem)", opacity: 1 },
            { transform: "translate(-50%, -3rem)", opacity: 0 },
          ]
        : [
            { transform: "translate(-50%, 0) scale(1)", opacity: 1 },
            { transform: "translate(-50%, -8rem) scale(1.4)", opacity: 0 },
          ],
      { duration: FLOAT_MS, easing: "ease-out", fill: "forwards" },
    );

    animation.onfinish = () => onLandRef.current();
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, []);

  return (
    <span
      ref={elementRef}
      aria-hidden
      className="pointer-events-none absolute bottom-full -translate-x-1/2 text-[2rem]"
      style={{ left: `${left}%` }}
    >
      <ReactionEmoji reaction={reaction} />
    </span>
  );
}

/** 작성자의 장에서 본 사람 목록을 받는다. 작성자가 아니면 `undefined`를 넘겨 받지 않는다. 수를 발치에 바로 보여 주므로 장이 뜨면 받는다. */
export function useStoryViewers(storyId: number | undefined) {
  return useQuery({
    queryKey: storyKeys.viewers(storyId ?? 0),
    queryFn: () => listStoryViewers(storyId ?? 0),
    staleTime: 30_000,
    enabled: storyId !== undefined,
  });
}

/**
 * 읽은 사람 패널의 열림 상태는 지금 history 항목의 state에 둔다. 목록에서 프로필에 다녀오면
 * 뷰어가 새로 그려지는데, 돌아온 항목이 열린 채였으면 패널도 다시 열린다. 공유 링크에 남을
 * 상태가 아니라 URL에는 두지 않는다.
 */
interface StoryViewersLocationState {
  storyViewersOpen?: boolean;
}

/** 항목별 목록 스크롤 위치. 다시 열 때 같은 자리로 돌아간다. 새로고침하면 잊는다. */
const panelScrollMemory = new Map<string, number>();

export function useStoryViewersPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as
    (StoryViewersLocationState & Record<string, unknown>) | null;
  const open = state?.storyViewersOpen === true;

  function setOpen(next: boolean) {
    if (next === open) return;
    // replace는 state를 승계하지 않으므로 뷰어가 쓰는 표식까지 함께 넘긴다.
    void navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      {
        replace: true,
        preventScrollReset: true,
        state: { ...state, storyViewersOpen: next },
      },
    );
  }

  return {
    open,
    setOpen,
    /** 다시 열 때 돌아갈 스크롤 위치. */
    scrollTop: panelScrollMemory.get(location.key) ?? 0,
    onScroll: (scrollTop: number) => {
      panelScrollMemory.set(location.key, scrollTop);
    },
  };
}

/** 뷰어는 한 번에 하나라 패널도 하나다. 트리거가 이 id로 패널을 가리킨다. */
const STORY_VIEWERS_PANEL_ID = "story-viewers-panel";

/** 발치에서 보이는 아바타 수. 인스타그램처럼 최근에 본 몇 명만 겹쳐 보인다. */
const TRIGGER_AVATARS = 3;

/**
 * 작성자 장의 발치에 두는 "읽은 사람" 버튼. 최근에 본 사람의 아바타를 겹쳐 놓고 수를 붙인다.
 * 누가 봤는지와 무엇을 보냈는지는 작성자만 안다(기능 명세 §17.6).
 */
export function StoryViewersTrigger({
  viewers,
  open,
  onOpen,
}: {
  viewers: StoryViewerEntry[] | undefined;
  open: boolean;
  onOpen: () => void;
}) {
  const count = viewers?.length;

  return (
    <button
      type="button"
      aria-label={count === undefined ? "읽은 사람" : `읽은 사람 ${count}명`}
      aria-controls={STORY_VIEWERS_PANEL_ID}
      aria-expanded={open}
      onClick={onOpen}
      className="pointer-events-auto flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-semibold text-white outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
    >
      {viewers && viewers.length > 0 ? (
        <span className="flex -space-x-2" aria-hidden>
          {viewers.slice(0, TRIGGER_AVATARS).map((viewer) => (
            <UserAvatar
              key={viewer.pubId}
              src={viewer.avatarUrl}
              name={viewer.name}
              size="default"
              className="ring-2 ring-black/60"
            />
          ))}
        </span>
      ) : (
        <EyeIcon className="size-5" aria-hidden />
      )}
      <span aria-hidden>
        {count === undefined ? "읽은 사람" : `${count}명`}
      </span>
    </button>
  );
}

/** 패널을 이만큼 아래로 끌어 놓으면 닫힌다. 댓글 시트(`use-sheet-drag.ts`)와 같은 값이다. */
const PANEL_CLOSE_DRAG_PX = 96;

/** 목록 맨 위에서 아래로 이만큼 당겨야 스크롤이 아니라 패널 끌기로 본다. */
const PULL_START_SLOP_PX = 6;

/**
 * 아래에서 올라오는 읽은 사람 목록. 그동안 스토리는 위로 작게 줄어든다(뷰어가 맡는다). 닫혀
 * 있어도 그려 둬서 올라오고 내려가는 모양이 이어진다. 닫히면 보조 기술과 포커스에서 뺀다.
 */
export function StoryViewersPanel({
  open,
  viewers,
  failed,
  scrollTop,
  onScroll,
  onClose,
}: {
  open: boolean;
  viewers: StoryViewerEntry[] | undefined;
  failed: boolean;
  /** 프로필에 다녀와 다시 열렸을 때 돌아갈 위치. */
  scrollTop: number;
  onScroll: (scrollTop: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ y: number } | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 열면 닫기 버튼으로 포커스를 옮기고, 닫으면 "읽은 사람" 버튼으로 돌려준다. 포커스가 남은 채
  // `aria-hidden`을 걸면 보조 기술에서 포커스가 사라지므로, 숨김 표시는 포커스를 옮긴 뒤에 직접
  // 단다. 그사이에는 `inert`가 포커스와 입력을 막는다.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    if (open) {
      panel.removeAttribute("aria-hidden");
      // 패널은 아직 화면 밖에서 올라오는 중이다. 그대로 포커스하면 브라우저가 패널을 보이려고
      // 조상을 스크롤한다.
      closeRef.current?.focus({ preventScroll: true });
      return;
    }

    const active = document.activeElement;
    if (active && panel.contains(active)) {
      const trigger = document.querySelector<HTMLElement>(
        `[aria-controls="${STORY_VIEWERS_PANEL_ID}"]`,
      );
      if (trigger) trigger.focus({ preventScroll: true });
      else if (active instanceof HTMLElement) active.blur();
    }
    panel.setAttribute("aria-hidden", "true");
  }, [open]);

  // 목록이 그려진 뒤 한 번만 되돌린다. 목록은 캐시에서 오므로 다녀온 직후에도 바로 있다.
  const restoredRef = useRef(false);
  const hasViewers = viewers !== undefined;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (restoredRef.current || !hasViewers || !list) return;
    restoredRef.current = true;
    list.scrollTop = scrollTop;
  }, [hasViewers, scrollTop]);

  function dragTo(dy: number) {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = dy === 0 ? "" : "none";
    panel.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  }

  /**
   * 목록 맨 위에서 이어 아래로 당겨도 패널을 내린다. 댓글 시트와 같은 손짓이다. 포인터 이벤트는
   * 브라우저가 스크롤로 가져가 `pointercancel`로 끊기므로 passive 아닌 `touchmove`에서
   * `preventDefault`한다.
   */
  useEffect(() => {
    const container = listRef.current;
    if (!open || !container) return;

    let pull: { touchId: number; startY: number; distance: number } | null =
      null;

    const start = (event: TouchEvent) => {
      // 맨 위에 붙어 있을 때만 받는다. 중간에서는 같은 손짓이 스크롤이다.
      if (event.touches.length !== 1 || container.scrollTop > 0) return;
      const touch = event.touches[0];
      pull = { touchId: touch.identifier, startY: touch.clientY, distance: 0 };
    };

    const move = (event: TouchEvent) => {
      if (!pull) return;
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === pull?.touchId,
      );
      if (!touch) return;

      const distance = touch.clientY - pull.startY;
      // 위로 밀었거나 목록이 다시 내려갔으면 평범한 스크롤이다.
      if (distance <= 0 || container.scrollTop > 0) {
        pull = null;
        dragTo(0);
        return;
      }
      if (distance < PULL_START_SLOP_PX) return;

      event.preventDefault();
      pull.distance = distance;
      dragTo(distance);
    };

    const finish = () => {
      const distance = pull?.distance ?? 0;
      pull = null;
      if (distance === 0) return;

      dragTo(0);
      if (distance >= PANEL_CLOSE_DRAG_PX) onCloseRef.current();
    };

    container.addEventListener("touchstart", start, { passive: true });
    container.addEventListener("touchmove", move, { passive: false });
    container.addEventListener("touchend", finish);
    container.addEventListener("touchcancel", finish);

    return () => {
      container.removeEventListener("touchstart", start);
      container.removeEventListener("touchmove", move);
      container.removeEventListener("touchend", finish);
      container.removeEventListener("touchcancel", finish);
    };
  }, [open]);

  return (
    <section
      ref={panelRef}
      id={STORY_VIEWERS_PANEL_ID}
      aria-label="읽은 사람"
      inert={!open}
      className={cn(
        "absolute inset-x-0 bottom-0 z-30 mx-auto flex h-[62dvh] max-w-md flex-col rounded-t-2xl bg-background text-foreground shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none",
        open ? "translate-y-0" : "translate-y-full",
      )}
    >
      {/* 머리를 아래로 끌면 닫힌다. 손잡이 모양으로 그럴 수 있다는 걸 알린다. */}
      <div
        className="flex shrink-0 cursor-grab touch-none items-center gap-2 px-4 pt-2 pb-2 active:cursor-grabbing"
        onPointerDown={(event) => {
          // 닫기 버튼에서 시작한 손짓은 가로채지 않는다. 끌다 놓아도 클릭이 그대로 일어난다.
          if ((event.target as Element).closest("button")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { y: event.clientY };
        }}
        onPointerMove={(event) => {
          if (dragRef.current) dragTo(event.clientY - dragRef.current.y);
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          dragTo(0);
          if (drag && event.clientY - drag.y >= PANEL_CLOSE_DRAG_PX) onClose();
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          dragTo(0);
        }}
      >
        <span className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/40" />
        <h2 className="mt-3 flex-1 text-base font-semibold">
          읽은 사람{viewers ? ` ${viewers.length}명` : ""}
        </h2>
        <Button
          ref={closeRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="읽은 사람 닫기"
          className="mt-3"
          onClick={onClose}
        >
          <ChevronDownIcon />
        </Button>
      </div>
      <div
        ref={listRef}
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-y-auto overscroll-x-desktop-auto overscroll-y-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {failed && !viewers ? (
          <p className="px-2 text-sm text-muted-foreground">
            읽은 사람을 불러오지 못했습니다.
          </p>
        ) : viewers?.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">
            아직 본 사람이 없습니다.
          </p>
        ) : (
          <ul>
            {viewers?.map((viewer) => (
              <StoryViewerRow key={viewer.pubId} viewer={viewer} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StoryViewerRow({ viewer }: { viewer: StoryViewerEntry }) {
  const summaryId = useId();
  const tally = REACTION_TYPES.map((type) => ({
    ...type,
    count: viewer.reactions.filter((reaction) => reaction === type.key).length,
  })).filter((type) => type.count > 0);

  return (
    <li
      aria-describedby={tally.length > 0 ? summaryId : undefined}
      className="flex items-center gap-3 rounded-md px-2 py-2.5"
    >
      <Link
        to={`/profile/${viewer.pubId}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <UserAvatar src={viewer.avatarUrl} name={viewer.name} size="lg" />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">
            {viewer.name}
          </span>
          <RelativeTime
            value={viewer.viewedAt}
            className="block text-xs text-muted-foreground"
          />
        </span>
      </Link>
      {tally.length > 0 ? (
        <span className="flex shrink-0 items-center gap-2 text-base tabular-nums">
          <span id={summaryId} className="sr-only">
            {tally.map((type) => `${type.label} ${type.count}`).join(", ")}
          </span>
          {tally.map((type) => (
            <span
              key={type.key}
              aria-hidden
              className="flex items-center gap-0.5"
            >
              <ReactionEmoji reaction={type.key} />
              {type.count > 1 ? type.count : null}
            </span>
          ))}
        </span>
      ) : null}
    </li>
  );
}
