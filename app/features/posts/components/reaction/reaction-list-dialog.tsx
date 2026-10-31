import { XIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Link } from "react-router";

import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import {
  useSheetDrag,
  useSheetViewport,
} from "~/features/posts/hooks/use-sheet-drag";
import type { PostReaction, PostReactor } from "~/features/posts/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/shared/ui/dialog";
import { ListRowSkeleton } from "~/shared/ui/skeleton";

function ReactionTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px flex flex-none items-center gap-1.5 border-b-2 px-2.5 py-3 text-sm font-medium whitespace-nowrap transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

interface ReactionListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reactors: PostReactor[];
  loading?: boolean;
  /** 스크린리더용 제목. 화면에서 헤더 역할은 탭 줄이 한다. */
  title?: string;
}

/**
 * 게시물 반응 참여자 목록. 데스크톱은 가운데 모달, 터치 기기는 끌어서 닫는 하단 시트다.
 * 처음 열 때 만든다. 카드와 댓글마다 달려 있어 미리 두면 닫힌 목록의 화면 크기 구독이 그 수만큼 쌓인다.
 * 한 번 연 뒤에는 남겨 닫히는 애니메이션을 지킨다.
 */
export function ReactionListDialog(props: ReactionListDialogProps) {
  const [mounted, setMounted] = useState(props.open);
  if (props.open && !mounted) setMounted(true);
  return mounted ? <ReactionListContent {...props} /> : null;
}

function ReactionListContent({
  open,
  onOpenChange,
  reactors,
  loading = false,
  title = "게시물 반응",
}: ReactionListDialogProps) {
  // null = 전체. 다시 열 때 이전 선택이 남지 않게 되돌린다.
  const [activeReaction, setActiveReaction] = useState<PostReaction | null>(
    null,
  );

  const { tabs, total } = useMemo(() => {
    const counts = new Map<PostReaction, number>();
    for (const row of reactors) {
      counts.set(row.reaction, (counts.get(row.reaction) ?? 0) + 1);
    }
    return {
      // 실제로 눌린 종류만 탭이 된다. 아무도 안 누른 종류의 빈 탭은 고를 이유가 없다.
      tabs: [...counts.entries()].sort((a, b) => b[1] - a[1]),
      total: [...counts.values()].reduce((sum, count) => sum + count, 0),
    };
  }, [reactors]);

  const shown = useMemo(
    () =>
      activeReaction === null
        ? reactors
        : reactors.filter((row) => row.reaction === activeReaction),
    [reactors, activeReaction],
  );

  const sheet = useSheetViewport();
  // 포털이 늦게 붙어 ref로는 첫 effect에 비어 있다.
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const drag = useSheetDrag({
    enabled: sheet,
    open,
    scrollElement: listElement,
    onDismiss: () => onOpenChange(false),
  });
  // 이 컴포넌트는 닫혀도 마운트돼 있다. 닫을 때가 아니라 열 때 되돌려야 닫히는 동안 탭이 바뀌지
  // 않고, 어떤 경로로 닫았든 닫히는 도중에 다시 열든 전체 탭으로 열린다.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setActiveReaction(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex h-[70svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl",
          sheet
            ? drag.sheetClassName
            : "max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0",
        )}
        style={sheet ? drag.sheetStyle : undefined}
      >
        {sheet ? (
          // 탭 줄은 가로 스크롤이라 드래그를 손잡이에만 건다.
          <div
            aria-hidden="true"
            data-testid="reaction-sheet-handle"
            className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
            {...drag.handleProps}
          >
            <span className="h-1 w-10 rounded-full bg-muted-foreground/35" />
          </div>
        ) : null}
        {/* 화면의 헤더는 아래 탭 줄이라 제목·설명은 스크린리더용이다. */}
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          반응 종류와 공개된 반응자 목록
        </DialogDescription>

        <div className="flex shrink-0 items-center border-b pr-2">
          <div
            role="tablist"
            aria-label="반응 종류"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden px-2"
          >
            <ReactionTab
              active={activeReaction === null}
              onClick={() => setActiveReaction(null)}
            >
              전체 {total}
            </ReactionTab>
            {tabs.map(([reaction, count]) => (
              <ReactionTab
                key={reaction}
                active={activeReaction === reaction}
                onClick={() => setActiveReaction(reaction)}
              >
                <ReactionEmoji
                  reaction={reaction}
                  labelled
                  className="text-base"
                />
                {count}
              </ReactionTab>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="닫기"
            className="ml-1 shrink-0 rounded-full text-muted-foreground"
            onClick={() => onOpenChange(false)}
          >
            <XIcon />
          </Button>
        </div>

        <div
          ref={setListElement}
          data-testid="reaction-list-scroll"
          // overscroll-y-contain: 맨 위에서 더 당길 때 브라우저의 새로고침 제스처가 손짓을 가져가지 않게 한다.
          className={cn(
            "min-h-0 flex-1 overflow-y-auto p-2",
            sheet && "overscroll-y-contain",
          )}
        >
          <ReactorList loading={loading} shown={shown} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 끄는 동안 시트가 프레임마다 다시 그려지므로 줄은 목록이 바뀔 때만 다시 만든다. */
const ReactorList = memo(function ReactorList({
  loading,
  shown,
}: {
  loading: boolean;
  shown: PostReactor[];
}) {
  return (
    <>
      {loading ? (
        <ListRowSkeleton
          label="반응한 사람을"
          avatar="lg"
          rowClassName="px-2 py-1.5"
        />
      ) : shown.length > 0 ? (
        <ul className="flex flex-col">
          {shown.map((row, index) => (
            <li
              key={row.reactor_pub_id ?? `${row.reacted_at}-${index}`}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5"
            >
              {row.reactor_pub_id && row.reactor_name ? (
                // 목록이 push한 entry를 프로필로 바꾼다. 돌아왔을 때 화면이 다시 그려지면
                // 목록을 연 버튼을 찾지 못해, 목록 없는 entry에서 뒤로가기를 한 번 헛누르게 된다.
                <Link
                  to={`/profile/${row.reactor_pub_id}`}
                  replace
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg hover:underline"
                >
                  <ReactorAvatar reaction={row.reaction}>
                    <UserAvatar
                      src={row.reactor_avatar_url}
                      name={row.reactor_name}
                      size="lg"
                    />
                  </ReactorAvatar>
                  <span className="truncate text-sm font-semibold">
                    {row.reactor_name}
                  </span>
                </Link>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <ReactorAvatar reaction={row.reaction}>
                    <UserAvatar src={null} name="탈퇴한 사용자" size="lg" />
                  </ReactorAvatar>
                  <span className="truncate text-sm font-semibold text-muted-foreground">
                    탈퇴한 사용자
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          아직 반응이 없습니다
        </p>
      )}
    </>
  );
});

function ReactorAvatar({
  reaction,
  children,
}: {
  reaction?: PostReaction;
  children: React.ReactNode;
}) {
  return (
    <span className="relative shrink-0">
      {children}
      {reaction ? (
        <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-background text-xs ring-2 ring-background">
          <ReactionEmoji reaction={reaction} labelled />
        </span>
      ) : null}
    </span>
  );
}
