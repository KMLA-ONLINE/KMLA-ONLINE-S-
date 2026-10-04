import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StoryComposer } from "~/features/stories/components/story-composer";
import { useStoryParam } from "~/features/stories/components/use-story-param";
import { StoryViewer } from "~/features/stories/components/story-viewer";
import { STORY_STALE_TIME, storyKeys } from "~/features/stories/data/cache";
import {
  listActiveStories,
  type StoryItem,
} from "~/features/stories/data/queries";
import {
  groupStoriesByAuthor,
  STORY_BACKGROUNDS,
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

export function StoryRail({
  initialItems,
  viewer,
  canWrite,
}: {
  initialItems: StoryItem[];
  viewer: { pubId: string; name: string; avatarUrl: string | null };
  canWrite: boolean;
}) {
  const [updatedItems, setUpdatedItems] = useState<StoryItem[] | null>(null);
  const { param, openComposer, openStory, showStory, close } = useStoryParam();

  const items = updatedItems ?? initialItems;
  const groups = groupStoriesByAuthor(items, viewer.pubId);
  const missingStory =
    param.kind === "story" && !items.some((item) => item.id === param.id);

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
    // 작성·삭제 쪽이 이미 캐시를 버렸으므로 여기서는 새로 받아 캐시를 다시 채운다.
    setUpdatedItems(
      await getQueryClient().query({
        queryKey: storyKeys.active(),
        queryFn: listActiveStories,
        staleTime: STORY_STALE_TIME,
      }),
    );
  }

  return (
    <>
      {groups.length > 0 || canWrite ? (
        <section className="border-b border-border bg-background pt-1 pb-2 md:border-0">
          <div className="[scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-1.5 px-2">
              {canWrite ? (
                <button
                  type="button"
                  onClick={openComposer}
                  className={cn(
                    CARD_CLASS,
                    "flex flex-col bg-card ring-1 ring-border ring-inset",
                  )}
                >
                  {/* Facebook처럼 위쪽은 내 프로필 사진으로 채운다. 사진이 없으면 아바타와 같은
                      실루엣을 쓴다(이니셜을 그리지 않는 이유는 UserAvatar 참고). */}
                  <span className="relative min-h-0 flex-1 overflow-hidden bg-muted">
                    <img
                      src={viewer.avatarUrl ?? "/avatar.svg"}
                      alt=""
                      loading="lazy"
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

              {groups.map((group) => {
                const cover = group.stories.at(-1);
                const isMine = group.pubId === viewer.pubId;

                if (!cover) return null;

                return (
                  <button
                    key={group.pubId}
                    type="button"
                    onClick={() => openStory(group.stories[0]?.id ?? cover.id)}
                    className={cn(
                      CARD_CLASS,
                      cover.background && STORY_BACKGROUNDS[cover.background],
                    )}
                    aria-label={
                      isMine
                        ? `내 스토리 ${group.stories.length}개 보기`
                        : `${cover.name} 스토리 ${group.stories.length}개 보기`
                    }
                  >
                    {cover.thumbnailUrl ? (
                      <img
                        src={cover.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 size-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs leading-4 font-bold [overflow-wrap:anywhere] break-keep text-white">
                        <span className="line-clamp-4">{cover.content}</span>
                      </span>
                    )}

                    <span className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />

                    <span className="absolute top-2 left-2 rounded-full bg-primary p-[2px]">
                      <UserAvatar
                        src={cover.avatarUrl}
                        name={cover.name}
                        className="size-8"
                      />
                    </span>

                    <span className="absolute inset-x-2 bottom-2 line-clamp-2 text-xs leading-4 font-semibold text-white">
                      {isMine ? "내 스토리" : cover.name}
                    </span>
                  </button>
                );
              })}
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
            close();
            await refresh();
          }}
        />
      ) : null}

      {canWrite ? (
        <StoryComposerDialog
          open={param.kind === "composer"}
          onClose={close}
          onDone={async () => {
            close();
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
  onDone,
}: {
  open: boolean;
  onClose: () => void;
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
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 max-sm:pt-[max(1.5rem,env(safe-area-inset-top))] max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-sm:ring-0"
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

        {open ? <StoryComposer onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}
