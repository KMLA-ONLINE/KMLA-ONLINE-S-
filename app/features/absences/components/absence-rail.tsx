import { XIcon } from "lucide-react";
import { useState } from "react";

import { AbsenceEditor } from "~/features/absences/components/absence-editor";
import {
  listTodayAbsences,
  type AbsenceItem,
} from "~/features/absences/data/queries";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

export function AbsenceRail({
  initialItems,
  viewerPubId,
}: {
  initialItems: AbsenceItem[];
  viewerPubId: string;
}) {
  const [updatedItems, setUpdatedItems] = useState<AbsenceItem[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<AbsenceItem | null>(null);

  const items = updatedItems ?? initialItems;
  const mine = items.find((item) => item.pubId === viewerPubId) ?? null;

  if (items.length === 0) return null;

  async function refreshAfterEdit() {
    setUpdatedItems(await listTodayAbsences());
    setEditOpen(false);
  }

  return (
    <>
      <section className="border-y border-border bg-background md:border-0">
        <div className="flex h-11 items-center px-4">
          <h2 className="text-[15px] font-semibold tracking-tight">
            공결 & 병결
          </h2>
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
                  className="flex w-[70px] shrink-0 flex-col items-center py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={
                    isMine
                      ? "내 공결 & 병결 수정"
                      : `${item.name} 공결 & 병결 사유 보기`
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

                  <span className="mt-0.5 w-full truncate text-center text-[11px] leading-4 text-muted-foreground">
                    {item.reason}
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

          <p className="leading-6 [overflow-wrap:anywhere] break-words">
            {selectedItem?.reason}
          </p>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent showCloseButton={false} className="gap-3">
          <DialogHeader className="flex-row items-center justify-between gap-3">
            <DialogTitle>공결 & 병결 수정</DialogTitle>

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
            <AbsenceEditor
              initialReason={mine.reason}
              onSaved={refreshAfterEdit}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
