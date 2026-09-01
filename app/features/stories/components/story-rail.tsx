import { ChevronRightIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { StoryEditor } from "~/features/stories/components/story-editor";
import { STORY_STALE_TIME, storyKeys } from "~/features/stories/data/cache";
import {
  listTodayStories,
  type StoryItem,
} from "~/features/stories/data/queries";
import { UserAvatar } from "~/shared/components/user-avatar";
import { getKoreaDateIso } from "~/shared/lib/korea-date";
import { getQueryClient } from "~/shared/lib/query-client";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

export function StoryRail({
  initialItems,
  viewerPubId,
}: {
  initialItems: StoryItem[];
  viewerPubId: string;
}) {
  const [updatedItems, setUpdatedItems] = useState<StoryItem[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StoryItem | null>(null);

  const items = updatedItems ?? initialItems;
  const mine = items.find((item) => item.pubId === viewerPubId) ?? null;

  if (items.length === 0) return null;

  async function refreshAfterEdit() {
    // StoryEditor가 이미 캐시를 버렸으므로 여기서는 새로 받아 캐시를 다시 채운다.
    setUpdatedItems(
      await getQueryClient().fetchQuery({
        queryKey: storyKeys.today(getKoreaDateIso()),
        queryFn: listTodayStories,
        staleTime: STORY_STALE_TIME,
      }),
    );
    setEditOpen(false);
  }

  return (
    <>
      <section className="border-y border-border bg-background md:border-0">
        <div className="flex h-11 items-center px-4">
          <Link
            to="/menu/story"
            className="-ml-1 flex items-center gap-0.5 rounded-md px-1 py-1 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h2 className="text-[15px] font-semibold tracking-tight">스토리</h2>

            <ChevronRightIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Link>
        </div>

        <div className="[scrollbar-width:none] overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-3 px-4">
            {items.map((item) => {
              const isMine = item.pubId === viewerPubId;

              return (
                <button
                  key={item.pubId}
                  type="button"
                  onClick={() => {
                    if (isMine) {
                      setEditOpen(true);
                    } else {
                      setSelectedItem(item);
                    }
                  }}
                  className="flex w-20 shrink-0 flex-col items-center py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={
                    isMine ? "내 스토리 수정" : `${item.name} 스토리 보기`
                  }
                >
                  <span className="rounded-full bg-border p-[2px]">
                    <span className="block rounded-full bg-background p-[2px]">
                      <UserAvatar
                        src={item.avatarUrl}
                        name={item.name}
                        className="size-14"
                      />
                    </span>
                  </span>

                  <span className="mt-1.5 max-w-full truncate text-center text-[13px] leading-4 font-semibold">
                    {item.name}
                  </span>

                  {/* 두 줄까지만 보여 주고, 넘치는 내용은 눌러서 전문을 본다. */}
                  <span className="mt-0.5 line-clamp-2 w-full text-center text-[11px] leading-4 [overflow-wrap:anywhere] break-keep text-muted-foreground">
                    {item.content}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <Dialog
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader className="flex-row items-center justify-between gap-4">
            <DialogTitle>{selectedItem?.name}</DialogTitle>

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

          {selectedItem ? (
            <p className="leading-6 [overflow-wrap:anywhere] break-words">
              {selectedItem.content}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent showCloseButton={false} className="gap-3">
          <DialogHeader className="flex-row items-center justify-between gap-3">
            <DialogTitle>스토리 수정</DialogTitle>

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

          {mine ? (
            <StoryEditor initial={mine.content} onSaved={refreshAfterEdit} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
