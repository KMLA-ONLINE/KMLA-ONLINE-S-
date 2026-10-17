import { useQuery } from "@tanstack/react-query";
import { ImageIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { StoryComposer } from "~/features/stories/components/story-composer";
import { useStoryParam } from "~/features/stories/components/use-story-param";
import { StoryViewer } from "~/features/stories/components/story-viewer";
import { STORY_STALE_TIME, storyKeys } from "~/features/stories/data/cache";
import { createStoryMediaUrls } from "~/features/stories/data/files";
import {
  listActiveStories,
  type StoryItem,
} from "~/features/stories/data/queries";
import {
  groupStoriesByAuthor,
  STORY_BACKGROUNDS,
  type StoryAuthorGroup,
} from "~/features/stories/model/story";
import { UserAvatar } from "~/shared/components/user-avatar";
import { getQueryClient } from "~/shared/lib/query-client";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

// 카드는 키보드 포커스 링을 그리지 않는다. 뷰어를 Esc로 닫으면 포커스가 카드로 돌아오면서
// focus-visible 링이 카드 테두리처럼 남아 보이기 때문이다. 그 대신 포커스 때 살짝 어둡게 한다.
const CARD_CLASS =
  "relative h-48 w-28 shrink-0 overflow-hidden rounded-xl bg-muted text-left outline-none focus-visible:brightness-90";

/** 레일 카드가 그 작성자의 다음 장으로 넘어가는 간격. */
const CARD_CYCLE_MS = 5_000;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// 첫 화면에 보이는 카드 수. 휴대폰 폭에서 작성 카드 옆으로 서너 장이 보인다. 이 카드들까지
// lazy로 두면 레이아웃이 끝난 뒤에야 낮은 우선순위로 요청이 나가서 사진이 한 박자 늦게 뜬다.
const EAGER_CARD_COUNT = 4;

/**
 * 카드를 누르는 순간 뷰어가 열 장(카드에 지금 보이는 장)의 원본을 서명하고 받기 시작한다. 뷰어도 같은 서명 캐시를
 * 지나므로(`createStoryMediaUrls`) 열리면서 다시 요청하지 않고, 클릭까지의 틈만큼 먼저 뜬다.
 */
function warmStoryImage(story: StoryItem) {
  if (!story.imagePath) return;

  const path = story.imagePath;

  void createStoryMediaUrls([path]).then(
    (urls) => {
      const url = urls.get(path);

      if (!url) return;

      // 뷰어의 <img>와 같은 CORS 모드로 받아야 같은 캐시 항목을 쓴다.
      const preload = new Image();
      preload.crossOrigin = "anonymous";
      preload.src = url;
    },
    () => undefined,
  );
}

export function StoryRail({
  initialItems,
  viewer,
  canWrite,
}: {
  initialItems: StoryItem[];
  viewer: { pubId: string; name: string; avatarUrl: string | null };
  canWrite: boolean;
}) {
  // 레일은 쿼리 캐시를 구독한다. 로더가 채운 값을 그대로 읽고, 작성·삭제 뒤의 무효화와 당겨서
  // 새로고침이 다시 받은 값도 같은 경로로 들어온다.
  const { data } = useQuery({
    queryKey: storyKeys.active(),
    queryFn: listActiveStories,
    staleTime: STORY_STALE_TIME,
  });
  const { param, openComposer, openStory, showStory, close } = useStoryParam();
  // 방금 지운 스토리. 목록 갱신이 주소에서 `?story=`가 빠지기 전에 도착해도 "찾을 수 없음"으로
  // 오인하지 않게 한다.
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  // 작성 창이 끝나는 시점에는 사용자가 이미 뒤로가기로 닫았을 수 있다. 그때 또 닫으면 홈 밖으로
  // 나가므로 지금도 열려 있는지 최신 값으로 확인한다.
  const paramKindRef = useRef(param.kind);
  // state가 아니라 ref다. 작성 창이 올리기 시작한 바로 그 이벤트 안에서 Esc가 와도 닫기 방어가
  // 다시 그려지기를 기다리지 않고 최신 값을 읽어야 한다(#244).
  const uploadingRef = useRef(false);

  useLayoutEffect(() => {
    paramKindRef.current = param.kind;
  });

  const items = data ?? initialItems;
  const groups = groupStoriesByAuthor(items, viewer.pubId);
  const missingStory =
    param.kind === "story" &&
    !deletedIds.has(param.id) &&
    !items.some((item) => item.id === param.id);

  // 공유 링크로 들어왔는데 이미 만료됐거나 볼 수 없는 스토리면 알리고 param을 걷는다.
  useEffect(() => {
    if (!missingStory) return;

    toast.error(
      "스토리를 찾을 수 없습니다. 24시간이 지났거나 볼 수 없는 스토리입니다.",
      {
        id: "story-not-found",
      },
    );
    close();
  }, [missingStory, close]);

  async function refresh() {
    // 실패하면 지금 목록을 그대로 둔다. 무효화된 상태라 다음 진입에서 다시 받는다.
    await getQueryClient()
      .invalidateQueries({ queryKey: storyKeys.active() })
      .catch(() => undefined);
  }

  return (
    <>
      {groups.length > 0 || canWrite ? (
        <section className="border-b border-border bg-background pt-1 pb-2 md:border-0">
          <div className="[scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
            {/* 넓은 화면에서는 아래 피드 카드와 좌우 끝을 맞춘다. 피드 카드는 여백 없이 열을 꽉
                채우므로 레일도 여백을 두지 않는다. */}
            <div className="flex w-max gap-1.5 px-2 md:px-0">
              {canWrite ? (
                <button
                  type="button"
                  onClick={openComposer}
                  className={cn(
                    CARD_CLASS,
                    // 테두리는 내용 위에 덮는다. 카드 자체에 inset ring을 주면 위를 채운 프로필
                    // 사진이 그 위로 그려져서 아래 글자 칸에만 테두리가 남는다.
                    "flex flex-col bg-card after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:ring-1 after:ring-border after:ring-inset",
                  )}
                >
                  {/* Facebook처럼 위쪽은 내 프로필 사진으로 채운다. 사진이 없으면 아바타와 같은
                      실루엣을 쓴다(이니셜을 그리지 않는 이유는 UserAvatar 참고). */}
                  <span className="relative min-h-0 flex-1 overflow-hidden bg-muted">
                    <img
                      src={viewer.avatarUrl ?? "/avatar.svg"}
                      crossOrigin="anonymous"
                      alt=""
                      decoding="async"
                      draggable={false}
                      className={cn(
                        "absolute inset-0 size-full object-cover",
                        !viewer.avatarUrl &&
                          "object-contain p-4 opacity-40 dark:opacity-55 dark:invert",
                      )}
                    />
                  </span>

                  <span className="relative flex h-11 shrink-0 items-end justify-center pb-2 text-xs font-semibold">
                    <span className="absolute top-0 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-card">
                      <PlusIcon className="size-4" aria-hidden />
                    </span>
                    스토리 만들기
                  </span>
                </button>
              ) : null}

              {groups.map((group, index) => (
                <StoryRailCard
                  key={group.pubId}
                  group={group}
                  isMine={group.pubId === viewer.pubId}
                  eager={index < EAGER_CARD_COUNT}
                  // 뷰어나 작성 창이 레일을 덮고 있으면 돌릴 이유가 없다.
                  paused={param.kind !== "none"}
                  onOpen={openStory}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {param.kind === "story" && !missingStory ? (
        <StoryViewer
          groups={groups}
          storyId={param.id}
          viewerPubId={viewer.pubId}
          onShow={showStory}
          onClose={close}
          onDeleted={async () => {
            setDeletedIds((previous) => new Set(previous).add(param.id));
            close();
            await refresh();
          }}
        />
      ) : null}

      {canWrite ? (
        <StoryComposerDialog
          open={param.kind === "composer"}
          onClose={() => {
            // 올리는 중에는 닫지 않는다. 닫아도 업로드는 계속되고, 끝날 때 다시 닫으려 한다.
            if (!uploadingRef.current) close();
          }}
          onPendingChange={(pending) => {
            uploadingRef.current = pending;
            // 브라우저 뒤로가기는 막을 수 없다. 이미 닫힌 창의 실패는 토스트로라도 알린다.
            if (!pending && paramKindRef.current !== "composer") {
              toast.error("스토리를 올리지 못했습니다.");
            }
          }}
          onDone={async () => {
            uploadingRef.current = false;
            if (paramKindRef.current === "composer") close();
            // 올리는 중에 뒤로가기로 닫았다. 취소된 줄 알고 다시 올리지 않게 끝났음을 알린다.
            else toast.success("스토리를 올렸습니다.");
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

function StoryComposerDialog({
  open,
  onClose,
  onPendingChange,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
  onDone: () => void | Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 max-sm:pt-[max(1.5rem,env(safe-area-inset-top))] max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-sm:ring-0 md:max-w-2xl"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3">
          <DialogTitle>스토리 만들기</DialogTitle>

          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                aria-label="닫기"
              />
            }
          >
            <XIcon />
          </DialogClose>
        </DialogHeader>

        {open ? (
          <StoryComposer onDone={onDone} onPendingChange={onPendingChange} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 작성자 카드. 장이 여럿이면 `CARD_CYCLE_MS`마다 다음 장을 보여 주고, 누르면 지금 보이는 장부터
 * 뷰어를 연다. 마우스를 올렸거나 누르고 있거나 키보드 포커스가 있거나 화면 밖이거나 탭이
 * 숨었으면 멈춘다. 움직임 줄이기
 * 설정이면 돌리지 않는다.
 */
function StoryRailCard({
  group,
  isMine,
  eager,
  paused,
  onOpen,
}: {
  group: StoryAuthorGroup<StoryItem>;
  isMine: boolean;
  eager: boolean;
  paused: boolean;
  onOpen: (storyId: number) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [shownIndex, setShownIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const count = group.stories.length;
  // 목록이 갱신되어 장이 줄었을 수 있다.
  const story = group.stories[shownIndex % count] ?? group.stories[0];
  const cycling =
    count > 1 &&
    !paused &&
    !hovered &&
    !pressed &&
    !focused &&
    !offscreen &&
    !hidden;

  useEffect(() => {
    if (!cycling) return;
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) return;

    const timer = window.setInterval(
      () => setShownIndex((index) => (index + 1) % count),
      CARD_CYCLE_MS,
    );

    return () => window.clearInterval(timer);
  }, [cycling, count]);

  // 다음 장의 축소본을 지금 받아 둔다. 넘어가는 순간에 받기 시작하면 느린 망에서 카드가 잠깐
  // 빈다. 돌지 않는 동안에는 받지 않는다.
  const upcomingThumbnail =
    count > 1
      ? group.stories[(shownIndex + 1) % count]?.thumbnailUrl
      : undefined;

  useEffect(() => {
    if (!cycling || !upcomingThumbnail) return;
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) return;

    // 카드의 <img>와 같은 CORS 모드로 받아야 같은 캐시 항목을 쓴다.
    const preload = new Image();
    preload.crossOrigin = "anonymous";
    preload.src = upcomingThumbnail;
  }, [cycling, upcomingThumbnail]);

  useEffect(() => {
    const button = buttonRef.current;

    if (!button || count < 2 || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(([entry]) =>
      setOffscreen(entry ? !entry.isIntersecting : false),
    );

    observer.observe(button);
    return () => observer.disconnect();
  }, [count]);

  useEffect(() => {
    if (count < 2) return;

    function onVisibilityChange() {
      setHidden(document.visibilityState === "hidden");
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [count]);

  if (!story) return null;

  const name = story.name;

  return (
    <button
      ref={buttonRef}
      type="button"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => {
        setPressed(true);
        warmStoryImage(story);
      }}
      onPointerUp={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPointerCancel={() => setPressed(false)}
      onClick={() => onOpen(story.id)}
      className={cn(
        CARD_CLASS,
        story.background && STORY_BACKGROUNDS[story.background],
      )}
      aria-label={
        isMine ? `내 스토리 ${count}개 보기` : `${name} 스토리 ${count}개 보기`
      }
    >
      {story.thumbnailUrl ? (
        <img
          key={story.id}
          src={story.thumbnailUrl}
          crossOrigin="anonymous"
          alt=""
          loading={eager ? undefined : "lazy"}
          decoding="async"
          className="absolute inset-0 size-full animate-in object-cover duration-300 fade-in"
          draggable={false}
        />
      ) : story.imagePath ? (
        // 사진 스토리인데 축소본을 서명하지 못했다. 글 스토리 모양으로 그리면 배경도 글도 없는
        // 빈 카드가 된다.
        <span className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground">
          <ImageIcon className="size-6" aria-hidden />
        </span>
      ) : (
        <span
          key={story.id}
          className="absolute inset-0 flex animate-in items-center justify-center p-3 text-center text-xs leading-4 font-bold [overflow-wrap:anywhere] break-keep text-white duration-300 fade-in"
        >
          <span className="line-clamp-4">{story.content}</span>
        </span>
      )}

      <span className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />

      <span className="absolute top-2 left-2 rounded-full bg-primary p-[2px]">
        <UserAvatar src={story.avatarUrl} name={name} className="size-8" />
      </span>

      <span className="absolute inset-x-2 bottom-2 line-clamp-2 text-xs leading-4 font-semibold text-white">
        {isMine ? "내 스토리" : name}
      </span>
    </button>
  );
}
