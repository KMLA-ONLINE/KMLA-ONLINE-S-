import { LinkIcon, MoreHorizontalIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { StoryCaption } from "~/features/stories/components/story-composer";
import { storyKeys } from "~/features/stories/data/cache";
import { createStoryMediaUrls } from "~/features/stories/data/files";
import { deleteMyStory } from "~/features/stories/data/mutations";
import type { StoryItem } from "~/features/stories/data/queries";
import {
  getStoryLinkLabel,
  STORY_BACKGROUNDS,
  STORY_DURATION_MS,
  type StoryAuthorGroup,
} from "~/features/stories/model/story";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { RelativeTime } from "~/shared/components/relative-time";
import { UserAvatar } from "~/shared/components/user-avatar";
import { getQueryClient } from "~/shared/lib/query-client";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

/** 누르고 있는 동안은 멈춘다. 이보다 짧게 눌렀다 떼면 탭으로 보고 장을 넘긴다. */
const HOLD_THRESHOLD_MS = 250;

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
  const pressRef = useRef<{ startedAt: number } | null>(null);

  const group = position ? groups[position.group] : undefined;
  const story = position ? group?.stories[position.story] : undefined;
  const following = position
    ? (group?.stories[position.story + 1] ??
      groups[position.group + 1]?.stories[0])
    : undefined;
  const isMine = group?.pubId === viewerPubId;
  const imageUrl = story?.imagePath
    ? (imageUrls.get(story.imagePath) ?? null)
    : null;
  const waitingForImage = Boolean(story?.imagePath) && loadedId !== story?.id;
  const paused = held || menuOpen || confirmingDelete || waitingForImage;

  function next() {
    if (!position || !group) return;

    const target =
      group.stories[position.story + 1] ??
      groups[position.group + 1]?.stories[0];

    // 마지막 장이 끝나면 닫지 않고 그 자리에 멈춘다. 닫기는 사용자가 한다.
    if (target) onShow(target.id);
  }

  function previous() {
    if (!position || !group) return;

    const target =
      group.stories[position.story - 1] ??
      groups[position.group - 1]?.stories.at(-1);

    if (target) onShow(target.id);
  }

  // 애니메이션 콜백과 키 처리기는 장이 바뀔 때만 다시 건다. 그 사이에도 최신 위치로 넘기도록
  // 처리기를 ref로 읽는다.
  const navigationRef = useRef({ next, previous });
  useLayoutEffect(() => {
    navigationRef.current = { next, previous };
  });

  // 원본은 그 장을 열 때 서명한다. 다음 장 것도 함께 서명하고 미리 받아 두어 넘길 때 바로
  // 뜨게 한다. 서명에 실패하면 이미지 없이 진행한다 — 기다리면 막대가 영영 멈춘다.
  const currentPath = story?.imagePath ?? null;
  const currentId = story?.id;
  const followingPath = following?.imagePath ?? null;

  useEffect(() => {
    if (!currentPath && !followingPath) return;

    let cancelled = false;

    void createStoryMediaUrls([currentPath, followingPath]).then(
      (urls) => {
        if (cancelled) return;

        setImageUrls((previous) => new Map([...previous, ...urls]));

        const followingUrl = followingPath ? urls.get(followingPath) : null;

        if (followingUrl) {
          // 뷰어의 <img>와 같은 CORS 모드로 받아야 같은 캐시 항목을 쓴다.
          const preload = new Image();
          preload.crossOrigin = "anonymous";
          preload.src = followingUrl;
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
  }, [currentPath, currentId, followingPath]);

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

    if (!animation) return;
    if (paused) animation.pause();
    else animation.play();
  }, [paused, progressElement, story?.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") navigationRef.current.next();
      if (event.key === "ArrowLeft") navigationRef.current.previous();
    }

    if (confirmingDelete) return;

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmingDelete]);

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
        <div
          className={cn(
            "relative size-full overflow-hidden select-none sm:aspect-[9/16] sm:h-[min(100dvh,56rem)] sm:w-auto sm:rounded-xl",
            story.background ? STORY_BACKGROUNDS[story.background] : "bg-black",
          )}
        >
          {imageUrl ? (
            <img
              key={story.id}
              src={imageUrl}
              crossOrigin="anonymous"
              alt={story.content || `${group.stories[0]?.name} 스토리 사진`}
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
              size="large"
            />
          ) : null}

          {/* 탭 영역. 왼쪽 3분의 1은 이전, 나머지는 다음이다. 누르고 있으면 멈춘다. */}
          <div
            className="absolute inset-0"
            onPointerDown={() => {
              pressRef.current = { startedAt: Date.now() };
              setHeld(true);
            }}
            onPointerUp={(event) => {
              const press = pressRef.current;

              pressRef.current = null;
              setHeld(false);

              // 다른 곳(버튼·링크)에서 누르기 시작한 손가락이 여기서 떨어진 것은 탭이 아니다.
              if (!press || Date.now() - press.startedAt > HOLD_THRESHOLD_MS) {
                return;
              }

              const rect = event.currentTarget.getBoundingClientRect();

              if (event.clientX - rect.left < rect.width / 3) previous();
              else next();
            }}
            onPointerCancel={() => {
              pressRef.current = null;
              setHeld(false);
            }}
            onPointerLeave={() => {
              pressRef.current = null;
              setHeld(false);
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
                      index === position.story ? setProgressElement : undefined
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
              <UserAvatar src={story.avatarUrl} name={story.name} size="sm" />
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
                    <DropdownMenuItem onClick={() => void copyStoryLink()}>
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
            <a
              href={story.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LinkIcon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">
                {getStoryLinkLabel(story.linkUrl)}
              </span>
            </a>
          ) : null}
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
