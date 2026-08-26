import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { setMyAbsence } from "~/features/absences/data/mutations";
import {
  listTodayAbsences,
  type AbsenceItem,
} from "~/features/absences/data/queries";
import {
  ABSENCE_REASON_MAX_LENGTH,
  isAbsenceReasonValid,
  normalizeAbsenceReason,
} from "~/features/absences/model/absence";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Textarea } from "~/shared/ui/textarea";

interface Viewer {
  pubId: string;
  name: string;
  avatarUrl: string | null;
}

export function AbsenceRail({
  initialItems,
  viewer,
}: {
  initialItems: AbsenceItem[];
  viewer: Viewer;
}) {
  const [updatedItems, setUpdatedItems] = useState<AbsenceItem[] | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = updatedItems ?? initialItems;

  const mine = items.find((item) => item.pubId === viewer.pubId) ?? null;

  const visibleItems = items.filter((item) => item.pubId !== viewer.pubId);

  const listItems = mine ? [mine, ...visibleItems] : visibleItems;

  const normalizedReason = normalizeAbsenceReason(reason);
  const valid = isAbsenceReasonValid(reason);

  function openEditor() {
    setReason(mine?.reason ?? "");
    setError(null);
    setEditorOpen(true);
  }

  async function submit() {
    if (!valid || pending) return;

    setPending(true);
    setError(null);

    try {
      await setMyAbsence(normalizedReason);
      setUpdatedItems(await listTodayAbsences());
      setEditorOpen(false);
    } catch {
      setError("저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <section className="border-y border-border bg-background">
        <div className="flex h-11 items-center justify-between px-4">
          <h2 className="text-[15px] font-semibold tracking-tight">
            오늘 공결&병결
          </h2>

          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => setListOpen(true)}
              className="-mr-1 flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              더보기
            </button>
          ) : null}
        </div>

        <div className="[scrollbar-width:none] overflow-x-auto overflow-y-visible pb-2 [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max snap-x gap-3 px-4">
            <button
              type="button"
              onClick={openEditor}
              aria-label={mine ? "내 공결&병결 수정" : "공결&병결 알리기"}
              className="flex w-[70px] shrink-0 snap-start flex-col items-center rounded-xl py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="relative">
                <span className="block rounded-full bg-primary/15 p-[3px]">
                  <span className="block rounded-full bg-background p-[2px]">
                    <UserAvatar
                      src={viewer.avatarUrl}
                      name={viewer.name}
                      className="size-14"
                    />
                  </span>
                </span>

                <span className="absolute -right-1 -bottom-0.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground ring-[3px] ring-background">
                  <PlusIcon className="size-4" aria-hidden="true" />
                </span>
              </span>

              <span className="mt-1.5 max-w-full truncate text-[13px] leading-4 font-semibold">
                {mine ? "수정" : "알리기"}
              </span>

              {mine ? (
                <span className="mt-0.5 w-full truncate text-center text-[11px] leading-4 text-muted-foreground">
                  {mine.reason}
                </span>
              ) : null}
            </button>

            {visibleItems.map((item) => (
              <article
                key={item.pubId}
                className="flex w-[70px] shrink-0 snap-start flex-col items-center py-1"
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

                <p className="mt-1.5 max-w-full truncate text-center text-[13px] leading-4 font-semibold">
                  {item.name}
                </p>

                <p
                  title={item.reason}
                  className="mt-0.5 w-full truncate text-center text-[11px] leading-4 text-muted-foreground"
                >
                  {item.reason}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <Dialog
        open={editorOpen}
        onOpenChange={(nextOpen) => {
          if (!pending) {
            setEditorOpen(nextOpen);
          }
        }}
      >
        <DialogContent className="gap-3 rounded-2xl p-4 sm:max-w-sm">
          <DialogHeader className="gap-0">
            <DialogTitle>
              {mine ? "공결&병결 수정" : "공결&병결 알리기"}
            </DialogTitle>
          </DialogHeader>

          <div>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              maxLength={ABSENCE_REASON_MAX_LENGTH}
              rows={3}
              placeholder="사유를 입력하세요"
              aria-invalid={Boolean(reason) && !valid}
              className="min-h-24 resize-none rounded-xl"
              disabled={pending}
            />

            <div className="mt-1.5 flex min-h-5 items-center justify-between">
              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : (
                <span />
              )}

              <span className="text-xs text-muted-foreground">
                {normalizedReason.length}/{ABSENCE_REASON_MAX_LENGTH}
              </span>
            </div>
          </div>

          <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={pending}
              onClick={() => setEditorOpen(false)}
            >
              취소
            </Button>

            <Button
              type="button"
              className="rounded-xl"
              disabled={pending || !valid}
              onClick={() => void submit()}
            >
              {pending ? "저장 중" : mine ? "수정" : "알리기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="flex max-h-[78dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 border-b px-4 py-4">
            <DialogTitle>오늘 공결&병결</DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto px-4 py-1">
            {listItems.map((item) => (
              <div
                key={item.pubId}
                className="flex items-start gap-3 border-b py-3 last:border-b-0"
              >
                <UserAvatar
                  src={item.avatarUrl}
                  name={item.name}
                  className="size-11 shrink-0"
                />

                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold">
                      {item.name}
                    </p>

                    {item.pubId === viewer.pubId ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        나
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-sm leading-5 break-words text-muted-foreground">
                    {item.reason}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
