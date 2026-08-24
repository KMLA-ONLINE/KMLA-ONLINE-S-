import { XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { ReactionEmoji } from "~/features/posts/components/reaction-emoji";
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
import { Spinner } from "~/shared/ui/spinner";

/**
 * 상단 필터 탭 한 칸. `-mb-px`로 버튼의 아래 테두리를 헤더의 `border-b` 위에 겹쳐, 활성 밑줄이
 * 구분선에 딱 붙게 한다.
 */
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
        "-mb-px flex flex-none items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 게시물 반응 참여자 목록 (기능 명세 §10.3).
 *
 * 반응자는 최근 반응순으로 한 줄씩 보여준다.
 *
 * 데스크톱은 가운데 모달, 모바일은 풀스크린이다(상세·작성 모달과 같은 패턴).
 */
export function ReactionListDialog({
  open,
  onOpenChange,
  reactors,
  loading = false,
  title = "게시물 반응",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reactors: PostReactor[];
  loading?: boolean;
  /** 스크린리더용 제목. 화면에서 헤더 역할은 탭 줄이 한다. */
  title?: string;
}) {
  // null = 전체. 다른 게시물을 열 때 이전 선택이 남지 않게 닫으면서 되돌린다.
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
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setActiveReaction(null);
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[70svh] flex-col gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-md"
      >
        {/* 제목과 설명은 스크린리더용이다. 화면에서 헤더 역할은 아래 탭 줄이 한다. */}
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

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : shown.length > 0 ? (
            <ul className="flex flex-col">
              {shown.map((row) => (
                <li
                  key={row.reactor_pub_id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5"
                >
                  <Link
                    to={`/profile/${row.reactor_pub_id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg hover:underline"
                  >
                    <ReactorAvatar reaction={row.reaction}>
                      <UserAvatar
                        src={row.reactor_avatar_path}
                        name={row.reactor_name}
                        size="lg"
                      />
                    </ReactorAvatar>
                    <span className="truncate text-sm font-semibold">
                      {row.reactor_name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              아직 반응이 없습니다
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 아바타 오른쪽 아래에 어떤 반응을 눌렀는지 작게 붙인다. */
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
