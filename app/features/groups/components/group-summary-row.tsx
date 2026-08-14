import { PinIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useFetcher } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import type { GroupHomeItem } from "~/features/groups/model/types";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

export function GroupSummaryRow({
  group,
  profileId,
}: {
  group: GroupHomeItem;
  profileId: number;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const pending = fetcher.state !== "idle";
  const isMember = group.membership_state === "member";
  const actionError = fetcher.data?.error ?? null;
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef({ x: 0, y: 0 });
  const suppressNextClick = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  useEffect(() => cancelLongPress, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isMember || event.pointerType === "mouse") return;

    cancelLongPress();
    longPressStart.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = setTimeout(() => {
      suppressNextClick.current = true;
      setPinDialogOpen(true);
      longPressTimer.current = null;
    }, 550);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!longPressTimer.current) return;

    const distance = Math.hypot(
      event.clientX - longPressStart.current.x,
      event.clientY - longPressStart.current.y,
    );
    if (distance > 8) cancelLongPress();
  };

  const handlePointerUp = () => {
    cancelLongPress();
    window.setTimeout(() => {
      suppressNextClick.current = false;
    }, 0);
  };

  return (
    <>
      <article
        data-slot="group-summary-row"
        className="relative flex touch-pan-y items-center gap-3 rounded-xl px-3 py-2.5 transition-colors select-none hover:bg-muted/40 md:border md:bg-card md:select-auto"
        onPointerDownCapture={handlePointerDown}
        onPointerMoveCapture={handlePointerMove}
        onPointerUpCapture={handlePointerUp}
        onPointerCancelCapture={cancelLongPress}
        onContextMenu={(event) => {
          if (suppressNextClick.current) event.preventDefault();
        }}
        onClickCapture={(event) => {
          if (!suppressNextClick.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressNextClick.current = false;
        }}
      >
        <GroupAvatar
          name={group.name}
          iconPath={group.icon_path}
          className="size-11 shrink-0 text-base"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">
              <Link
                to={`/groups/${group.slug}`}
                className="after:absolute after:inset-0"
              >
                {group.name}
              </Link>
            </h3>
            {group.identity_policy === "always_anonymous" ? (
              <Badge variant="secondary">항상 익명</Badge>
            ) : null}
          </div>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground md:hidden">
            {group.pinned_at ? (
              <>
                <PinIcon
                  aria-hidden
                  className="size-3 -rotate-45 text-primary"
                />
                <span className="sr-only">고정됨</span>
              </>
            ) : null}
            멤버 {group.member_count.toLocaleString("ko-KR")}명
          </p>
          <p className="hidden truncate text-xs text-muted-foreground md:block">
            {group.kind === "unofficial" ? (
              <span className="tabular-nums">
                멤버 {group.member_count.toLocaleString("ko-KR")}명 ·{" "}
              </span>
            ) : null}
            {group.description || "아직 그룹 설명이 없습니다."}
          </p>
          {actionError ? (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {actionError}
            </p>
          ) : null}
        </div>
        {isMember ? (
          <fetcher.Form method="post" className="relative z-10 shrink-0">
            <PinFields
              groupId={group.group_id}
              profileId={profileId}
              pinned={Boolean(group.pinned_at)}
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              aria-label={group.pinned_at ? "고정 해제" : "그룹 고정"}
              aria-pressed={Boolean(group.pinned_at)}
              disabled={pending}
              className={`${group.pinned_at ? "text-primary" : "text-muted-foreground"} sr-only focus:not-sr-only md:not-sr-only`}
            >
              {pending ? <Spinner /> : <PinIcon className="-rotate-45" />}
            </Button>
          </fetcher.Form>
        ) : null}
      </article>

      {isMember ? (
        <Dialog open={pinDialogOpen} onOpenChange={setPinDialogOpen}>
          <DialogContent className="max-w-xs" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{group.name}</DialogTitle>
              <DialogDescription>
                {group.pinned_at
                  ? "이 그룹을 내 그룹 목록의 일반 정렬 위치로 돌릴까요?"
                  : "이 그룹을 내 그룹 목록 상단에 고정할까요?"}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPinDialogOpen(false)}
              >
                취소
              </Button>
              <fetcher.Form method="post">
                <PinFields
                  groupId={group.group_id}
                  profileId={profileId}
                  pinned={Boolean(group.pinned_at)}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={pending}
                  onClick={() => setPinDialogOpen(false)}
                >
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  {group.pinned_at ? "고정 해제" : "고정"}
                </Button>
              </fetcher.Form>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function PinFields({
  groupId,
  profileId,
  pinned,
}: {
  groupId: string;
  profileId: number;
  pinned: boolean;
}) {
  return (
    <>
      <input type="hidden" name="intent" value="pin" />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="pinned" value={pinned ? "false" : "true"} />
    </>
  );
}
