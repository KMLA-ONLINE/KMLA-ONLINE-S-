import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LinkIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  StoryCaption,
  StoryLinkPill,
} from "~/features/stories/components/story-canvas";
import { storyKeys } from "~/features/stories/data/cache";
import { createStoryMediaUrls } from "~/features/stories/data/files";
import { deleteMyStory } from "~/features/stories/data/mutations";
import type { StoryItem } from "~/features/stories/data/queries";
import {
  findAuthorJump,
  readStoryGesture,
  STORY_BACKGROUNDS,
  STORY_DURATION_MS,
  type StoryAuthorGroup,
} from "~/features/stories/model/story";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { RelativeTime } from "~/shared/components/relative-time";
import { UserAvatar } from "~/shared/components/user-avatar";
import { getQueryClient } from "~/shared/lib/query-client";
import { resistDrag } from "~/shared/lib/drag-resistance";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

/**
 * 넘어갈 곳이 없는 쪽으로 쓸 때 카드가 움직여 보이는 최대 거리. 위아래로 쓸어 닫을 때와 끝
 * 작성자에서 옆으로 쓸 때다. 놓으면 닫힌다는 걸 알릴 만큼만 움직인다.
 */
const SWIPE_DRAG_LIMIT_PX = 48;

/** 손가락이 이만큼 움직이면 가로·세로 중 한 축으로 고정한다. 중간에 축이 바뀌면 카드가 흔들린다. */
const AXIS_LOCK_PX = 10;

/** 옆 작성자로 밀려 넘어가는 시간. */
const SLIDE_MS = 260;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * 지금 보는 장은 부모가 쥔다(URL의 `?story=<id>`). 뷰어는 그 id가 어느 작성자의 몇 번째 장인지
 * 찾아 그리고, 넘길 때는 다음 장의 id를 `onShow`로 알린다. 부모가 그 id를 찾지 못하는 경우
 * (만료·삭제·권한 없음)는 부모가 처리하므로 여기서는 그리지 않는다.
 */
export function StoryViewer({
  groups,
  storyId,
  viewerPubId,
  onShow,
  onClose,
  onDeleted,
}: {
  groups: StoryAuthorGroup<StoryItem>[];
  storyId: number;
  viewerPubId: string;
  onShow: (storyId: number) => void;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const position = findStoryPosition(groups, storyId);
  const [held, setHeld] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // 다른 탭으로 가거나 화면을 끄면 멈춘다. 그러지 않으면 아무도 보지 않는 사이 다음 작성자들의
  // 스토리로 넘어간다.
  const [hidden, setHidden] = useState(false);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [imageUrls, setImageUrls] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  // 진행 막대 요소는 state로 받는다. 뷰어는 portal 안이라 처음 열린 커밋의 effect 시점에는
  // 아직 DOM에 붙지 않았을 수 있다. ref 객체로 읽으면 첫 장에서만 애니메이션이 걸리지 않는다.
  const [progressElement, setProgressElement] =
    useState<HTMLSpanElement | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{
    startedAt: number;
    x: number;
    y: number;
    axis: "x" | "y" | null;
  } | null>(null);
  // 옆 작성자로 밀려 가는 중이다. 그동안의 손가락은 무시한다.
  const slideTimerRef = useRef<number | null>(null);
  // 밀려 간 트랙을 새 장이 그려지는 커밋에서 제자리로 돌린다. 그보다 먼저 돌리면 한 프레임 동안
  // 이전 작성자가 다시 보인다.
  const resetTrackRef = useRef(false);

  const group = position ? groups[position.group] : undefined;
  const story = position ? group?.stories[position.story] : undefined;
  const following = position
    ? (group?.stories[position.story + 1] ??
      groups[position.group + 1]?.stories[0])
    : undefined;
  const hasPrevious = position
    ? position.story > 0 || position.group > 0
    : false;
  // 옆으로 쓸 때 양옆에 미리 깔아 두는 이웃 작성자의 첫 장.
  const previousAuthorStory = position
    ? groups[position.group - 1]?.stories[0]
    : undefined;
  const nextAuthorStory = position
    ? groups[position.group + 1]?.stories[0]
    : undefined;
  const isMine = group?.pubId === viewerPubId;
  const imageUrl = story?.imagePath
    ? (imageUrls.get(story.imagePath) ?? null)
    : null;
  const waitingForImage = Boolean(story?.imagePath) && loadedId !== story?.id;
  const paused =
    held || hidden || menuOpen || confirmingDelete || waitingForImage;

  function next() {
    if (!position || !group) return;

    const target =
      group.stories[position.story + 1] ??
      groups[position.group + 1]?.stories[0];

    // 마지막 장이 끝나면 닫지 않고 그 자리에 멈춘다. 닫기는 사용자가 한다.
    if (target) onShow(target.id);
  }

  /**
   * 쓰는 동안 트랙이 손가락을 따라간다. 옆으로는 이웃 작성자의 카드가 깔려 있으면 1:1로 따라가
   * 그 카드가 딸려 들어오고, 넘어갈 곳이 없으면 저항을 두어 `SWIPE_DRAG_LIMIT_PX` 근처에서
   * 멈춘다. 위아래는 닫기 동작이라 저항을 두고 살짝 작아진다. 프레임마다 React를 다시 그리지
   * 않도록 style을 직접 쓴다.
   */
  function dragTrack(dx: number, dy: number) {
    const track = trackRef.current;
    if (!track) return;

    const neighbor = dx < 0 ? nextAuthorStory : previousAuthorStory;
    const x = neighbor ? dx : resistDrag(dx, SWIPE_DRAG_LIMIT_PX);
    const y = resistDrag(dy, SWIPE_DRAG_LIMIT_PX);
    const shrink = Math.min(Math.abs(dy) / 2000, 0.04);

    track.style.transition = "none";
    track.style.transform = `translate(${x}px, ${y}px) scale(${1 - shrink})`;
  }

  /** 넘어가지 않고 떼면 제자리로 돌아간다. */
  function settleTrack() {
    const track = trackRef.current;
    if (!track?.style.transform) return;

    track.style.transition = "transform 200ms ease-out";
    track.style.transform = "";
  }

  /**
   * 이웃 작성자의 카드가 화면을 다 채울 때까지 밀고 나서 그 장으로 바꾼다. 바꾸는 순간 보이는
   * 것은 이미 깔려 있던 같은 카드라 이어져 보인다. 측정할 폭이 없거나 움직임 줄이기면 바로
   * 바꾼다.
   */
  function slideToAuthor(direction: "previous" | "next", storyId: number) {
    const track = trackRef.current;
    const width = viewportRef.current?.clientWidth ?? 0;
    const reduced = window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;

    if (!track || !width || reduced) {
      if (track) track.style.transform = "";
      onShow(storyId);
      return;
    }

    track.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
    track.style.transform = `translateX(${direction === "next" ? -width : width}px)`;
    slideTimerRef.current = window.setTimeout(() => {
      slideTimerRef.current = null;
      resetTrackRef.current = true;
      onShow(storyId);
    }, SLIDE_MS);
  }

  useLayoutEffect(() => {
    const track = trackRef.current;

    if (!resetTrackRef.current || !track) return;

    resetTrackRef.current = false;
    track.style.transition = "none";
    track.style.transform = "";
  }, [story?.id]);

  useEffect(
    () => () => {
      if (slideTimerRef.current !== null) {
        window.clearTimeout(slideTimerRef.current);
      }
    },
    [],
  );

  function previous() {
    if (!position || !group) return;

    const target =
      group.stories[position.story - 1] ??
      groups[position.group - 1]?.stories.at(-1);

    if (target) {
      onShow(target.id);
      return;
    }

    // 맨 첫 장에서 이전을 누르면 그 장을 처음부터 다시 보여 준다.
    const animation = animationRef.current;

    if (animation) {
      animation.currentTime = 0;
      if (!paused) animation.play();
    }
  }

  // 애니메이션 콜백과 키 처리기는 장이 바뀔 때만 다시 건다. 그 사이에도 최신 위치로 넘기도록
  // 처리기를 ref로 읽는다.
  const navigationRef = useRef({ next, previous });
  useLayoutEffect(() => {
    navigationRef.current = { next, previous };
  });

  // 원본은 그 장을 열 때 서명한다. 다음 장과 다음 작성자의 첫 장 것도 함께 서명하고 미리 받아
  // 두어 탭이나 쓸기로 넘길 때 바로 뜨게 한다. 서명에 실패하면 이미지 없이 진행한다 — 기다리면
  // 막대가 영영 멈춘다.
  const currentPath = story?.imagePath ?? null;
  const currentId = story?.id;
  const followingPath = following?.imagePath ?? null;
  const nextAuthorPath = nextAuthorStory?.imagePath ?? null;

  useEffect(() => {
    if (!currentPath && !followingPath && !nextAuthorPath) return;

    let cancelled = false;

    void createStoryMediaUrls([
      currentPath,
      followingPath,
      nextAuthorPath,
    ]).then(
      (urls) => {
        if (cancelled) return;

        setImageUrls((previous) => new Map([...previous, ...urls]));

        for (const path of [followingPath, nextAuthorPath]) {
          const url = path ? urls.get(path) : null;

          if (!url) continue;

          // 뷰어의 <img>와 같은 CORS 모드로 받아야 같은 캐시 항목을 쓴다.
          const preload = new Image();
          preload.crossOrigin = "anonymous";
          preload.src = url;
        }
        if (currentPath && !urls.has(currentPath) && currentId !== undefined) {
          setLoadedId(currentId);
        }
      },
      () => {
        if (!cancelled && currentId !== undefined) setLoadedId(currentId);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [currentPath, currentId, followingPath, nextAuthorPath]);

  // 진행 막대는 Web Animations로 돌린다. 멈춤과 재개가 `pause()`·`play()` 한 줄이고, 끝나는
  // 시점이 곧 다음 장으로 넘어가는 시점이라 타이머를 따로 두지 않는다.
  useEffect(() => {
    const element = progressElement;

    if (!element || typeof element.animate !== "function") return;

    const animation = element.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: STORY_DURATION_MS, easing: "linear", fill: "forwards" },
    );

    animation.pause();
    animation.onfinish = () => navigationRef.current.next();
    animationRef.current = animation;

    return () => {
      animation.onfinish = null;
      animation.cancel();
      animationRef.current = null;
    };
  }, [progressElement, story?.id]);

  useEffect(() => {
    const animation = animationRef.current;

    // 마지막 장은 끝난 채로 멈춰 있다. 끝난 애니메이션에 play()를 부르면 처음부터 다시 돈다.
    if (!animation || animation.playState === "finished") return;
    if (paused) animation.pause();
    else animation.play();
  }, [paused, progressElement, story?.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") navigationRef.current.next();
      if (event.key === "ArrowLeft") navigationRef.current.previous();
    }

    // 메뉴가 열려 있으면 화살표는 메뉴 항목을 움직이는 데 쓴다.
    if (confirmingDelete || menuOpen) return;

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmingDelete, menuOpen]);

  useEffect(() => {
    function onVisibilityChange() {
      setHidden(document.visibilityState === "hidden");
    }

    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  async function copyStoryLink() {
    if (!story) return;

    try {
      await navigator.clipboard.writeText(
        new URL(`/?story=${story.id}`, window.location.origin).toString(),
      );
      toast.success("스토리 링크를 복사했습니다.");
    } catch {
      toast.error("스토리 링크를 복사하지 못했습니다.");
    }
  }

  async function remove() {
    if (!story || deleting) return;

    setDeleting(true);

    try {
      await deleteMyStory(story.id);
    } catch {
      toast.error("스토리를 삭제하지 못했습니다.");
      return;
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }

    // 이미 지워졌다. 이후 갱신이 실패해도 삭제 실패로 알리지 않는다.
    await getQueryClient()
      .invalidateQueries({ queryKey: storyKeys.all, refetchType: "none" })
      .catch(() => undefined);
    await Promise.resolve(onDeleted()).catch(() => undefined);
  }

  if (!position || !group || !story) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 h-dvh max-w-none translate-x-0 translate-y-0 place-items-center gap-0 rounded-none bg-black p-0 text-white ring-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        {/* 데스크톱은 카드 양옆이 비어 있어 그 자리에 넘김 버튼을 둔다. 양 끝에서도 자리는 남겨
            카드가 가운데에서 움직이지 않게 한다. 모바일은 카드가 화면을 채우므로 탭만 쓴다. */}
        <div className="flex size-full items-center justify-center gap-4 sm:size-auto">
          <StoryNavButton
            label="이전 스토리"
            hidden={!hasPrevious}
            onClick={previous}
          >
            <ChevronLeftIcon />
          </StoryNavButton>
          {/* 카드 자리. 옆으로 쓸면 안의 트랙이 움직이고 이웃 작성자의 카드가 이 자리 안으로 밀려
              들어온다. 바깥은 잘라서 데스크톱에서도 이웃 카드가 넘김 버튼 쪽으로 새지 않는다. */}
          <div
            ref={viewportRef}
            className="relative size-full overflow-hidden select-none sm:aspect-[9/16] sm:h-[min(100dvh,56rem)] sm:w-auto sm:rounded-xl"
          >
            <div ref={trackRef} className="absolute inset-0">
              {previousAuthorStory ? (
                <div className="absolute inset-0 -translate-x-full" aria-hidden>
                  <StoryFace story={previousAuthorStory} />
                </div>
              ) : null}
              {nextAuthorStory ? (
                <div className="absolute inset-0 translate-x-full" aria-hidden>
                  <StoryFace story={nextAuthorStory} />
                </div>
              ) : null}
              <div
                className={cn(
                  "@container absolute inset-0 overflow-hidden",
                  story.background
                    ? STORY_BACKGROUNDS[story.background]
                    : "bg-black",
                )}
              >
                {/* 원본을 받는 동안은 레일이 이미 받아 둔 축소본을 깐다. 옆으로 밀려 들어온 미리보기도
                축소본이라, 장이 바뀌는 순간 검은 화면으로 깜박이지 않는다. */}
                {story.thumbnailUrl && loadedId !== story.id ? (
                  <img
                    key={`thumbnail-${story.id}`}
                    src={story.thumbnailUrl}
                    crossOrigin="anonymous"
                    alt=""
                    className="absolute inset-0 size-full object-contain"
                    draggable={false}
                  />
                ) : null}

                {imageUrl ? (
                  <img
                    key={story.id}
                    src={imageUrl}
                    crossOrigin="anonymous"
                    alt={
                      story.content || `${group.stories[0]?.name} 스토리 사진`
                    }
                    onLoad={() => setLoadedId(story.id)}
                    onError={() => setLoadedId(story.id)}
                    className="absolute inset-0 size-full object-contain"
                    draggable={false}
                  />
                ) : null}

                {story.content ? (
                  <StoryCaption
                    text={story.content}
                    overlay={story.imagePath !== null}
                    hasLink={story.linkUrl !== null}
                    placement={story.layout?.text}
                  />
                ) : null}

                {/* 탭 영역. 왼쪽 3분의 1은 이전, 나머지는 다음이다. 누르고 있으면 멈추고, 옆으로 쓸면
                작성자를 건너뛰고, 위나 아래로 쓸면 닫는다. `touch-none`이 없으면 브라우저가 쓸기를 스크롤로 가져가며
                pointercancel을 보내 떼는 순간을 받지 못한다. */}
                <div
                  data-testid="story-gesture-area"
                  className="absolute inset-0 touch-none"
                  onPointerDown={(event) => {
                    // 옆 작성자로 밀려 가는 동안의 손가락은 받지 않는다.
                    if (slideTimerRef.current !== null) return;
                    // 마우스로 끌다 카드 밖으로 나가도 떼는 순간을 받는다. 터치는 원래 이렇게 묶인다.
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pressRef.current = {
                      startedAt: Date.now(),
                      x: event.clientX,
                      y: event.clientY,
                      axis: null,
                    };
                    setHeld(true);
                  }}
                  onPointerMove={(event) => {
                    const press = pressRef.current;
                    if (!press) return;

                    const dx = event.clientX - press.x;
                    const dy = event.clientY - press.y;

                    if (!press.axis) {
                      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX)
                        return;
                      press.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
                    }
                    if (press.axis === "x") dragTrack(dx, 0);
                    else dragTrack(0, dy);
                  }}
                  onPointerUp={(event) => {
                    const press = pressRef.current;

                    pressRef.current = null;
                    setHeld(false);

                    // 다른 곳(버튼·링크)에서 누르기 시작한 손가락이 여기서 떨어진 것은 탭이 아니다.
                    if (!press) return;

                    const rect = event.currentTarget.getBoundingClientRect();
                    const gesture = readStoryGesture({
                      dx: event.clientX - press.x,
                      dy: event.clientY - press.y,
                      durationMs: Date.now() - press.startedAt,
                      x: event.clientX - rect.left,
                      width: rect.width,
                    });

                    if (gesture.kind === "close") {
                      onClose();
                      return;
                    }
                    if (gesture.kind === "author" && position) {
                      const jump = findAuthorJump(
                        groups,
                        position.group,
                        gesture.direction,
                      );

                      if (jump.kind === "close") {
                        onClose();
                        return;
                      }
                      if (jump.kind === "show") {
                        slideToAuthor(gesture.direction, jump.id);
                        return;
                      }
                    }
                    settleTrack();
                    if (gesture.kind !== "tap") return;
                    if (gesture.side === "previous") previous();
                    else next();
                  }}
                  onPointerCancel={() => {
                    pressRef.current = null;
                    setHeld(false);
                    settleTrack();
                  }}
                  onPointerLeave={() => {
                    pressRef.current = null;
                    setHeld(false);
                    settleTrack();
                  }}
                  aria-hidden
                />

                <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/50 to-transparent px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-8">
                  <div className="flex gap-1">
                    {group.stories.map((item, index) => (
                      <span
                        key={item.id}
                        className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35"
                      >
                        {/* Tailwind 4의 scale-x-* 는 `transform`이 아니라 `scale` 속성을 써서
                      애니메이션의 transform과 곱해진다. 그래서 시작값도 transform으로 둔다. */}
                        <span
                          ref={
                            index === position.story
                              ? setProgressElement
                              : undefined
                          }
                          className="block h-full origin-left bg-white"
                          style={{
                            transform: `scaleX(${index < position.story ? 1 : 0})`,
                          }}
                        />
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    {/* 뷰어를 띄운 `?story=` 기록 항목은 남으므로 뒤로 가면 이 장으로 돌아온다. */}
                    <Link
                      to={`/profile/${group.pubId}`}
                      aria-label={`${story.name} 프로필`}
                      className="pointer-events-auto shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                    >
                      <UserAvatar
                        src={story.avatarUrl}
                        name={story.name}
                        size="sm"
                      />
                    </Link>
                    <DialogTitle className="truncate text-sm font-semibold text-white">
                      {story.name}
                    </DialogTitle>
                    <RelativeTime
                      value={story.publishedAt}
                      className="shrink-0 text-xs text-white/70"
                    />

                    <div className="pointer-events-auto ml-auto flex items-center">
                      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-white hover:bg-white/15 hover:text-white"
                              aria-label="스토리 옵션"
                            />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-auto whitespace-nowrap"
                        >
                          <DropdownMenuItem
                            onClick={() => void copyStoryLink()}
                          >
                            <LinkIcon />
                            스토리 링크 복사
                          </DropdownMenuItem>
                          {isMine ? (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setConfirmingDelete(true)}
                            >
                              <Trash2Icon />
                              스토리 삭제
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-white hover:bg-white/15 hover:text-white"
                        aria-label="닫기"
                        onClick={onClose}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  </div>
                </div>

                {story.linkUrl ? (
                  <StoryLinkPill
                    url={story.linkUrl}
                    interactive
                    placement={story.layout?.link}
                  />
                ) : null}
              </div>
            </div>
          </div>
          <StoryNavButton
            label="다음 스토리"
            hidden={!following}
            onClick={next}
          >
            <ChevronRightIcon />
          </StoryNavButton>
        </div>

        {confirmingDelete ? (
          <ConfirmDialog
            title="스토리를 삭제할까요?"
            description="삭제한 스토리는 되돌릴 수 없습니다."
            confirmLabel="삭제"
            destructive
            pending={deleting}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={() => void remove()}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 옆으로 쓸 때 양옆에 깔아 두는 이웃 작성자의 첫 장. 보기만 하는 그림이라 레일이 이미 받아 둔
 * 축소본과 글, 링크, 작성자만 그린다. 넘어가면 같은 모양의 실제 장이 그 자리를 이어받는다.
 */
function StoryFace({ story }: { story: StoryItem }) {
  return (
    <div
      className={cn(
        "@container absolute inset-0 overflow-hidden",
        story.background ? STORY_BACKGROUNDS[story.background] : "bg-black",
      )}
    >
      {story.thumbnailUrl ? (
        <img
          src={story.thumbnailUrl}
          crossOrigin="anonymous"
          alt=""
          className="absolute inset-0 size-full object-contain"
          draggable={false}
        />
      ) : null}
      {story.content ? (
        <StoryCaption
          text={story.content}
          overlay={story.imagePath !== null}
          hasLink={story.linkUrl !== null}
          placement={story.layout?.text}
        />
      ) : null}
      {story.linkUrl ? (
        <StoryLinkPill
          url={story.linkUrl}
          interactive={false}
          placement={story.layout?.link}
        />
      ) : null}
      {/* 실제 장의 머리(진행 막대 아래 작성자 줄)와 같은 높이에 둔다. */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/50 to-transparent px-3 pt-[calc(max(0.75rem,env(safe-area-inset-top))+0.875rem)] pb-8">
        <UserAvatar src={story.avatarUrl} name={story.name} size="sm" />
        <span className="truncate text-sm font-semibold text-white">
          {story.name}
        </span>
      </div>
    </div>
  );
}

function StoryNavButton({
  label,
  hidden,
  onClick,
  children,
}: {
  label: string;
  hidden: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      onClick={onClick}
      className={cn(
        "hidden shrink-0 rounded-full bg-white/15 text-white hover:bg-white/30 hover:text-white sm:inline-flex",
        hidden && "invisible",
      )}
    >
      {children}
    </Button>
  );
}

function findStoryPosition(
  groups: StoryAuthorGroup<StoryItem>[],
  storyId: number,
): { group: number; story: number } | null {
  for (const [groupIndex, group] of groups.entries()) {
    const storyIndex = group.stories.findIndex((item) => item.id === storyId);

    if (storyIndex >= 0) return { group: groupIndex, story: storyIndex };
  }

  return null;
}
