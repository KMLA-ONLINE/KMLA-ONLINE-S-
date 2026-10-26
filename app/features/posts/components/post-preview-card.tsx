import { useQuery } from "@tanstack/react-query";
import { EyeOffIcon, RotateCwIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";

import { StaffMark } from "~/features/posts/components/staff-mark";
import { postPreviewQuery } from "~/features/posts/data/cache";
import { extractPostPlainText } from "~/features/posts/model/markdown";
import { UserAvatar } from "~/shared/components/user-avatar";
import { useT } from "~/shared/i18n";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Skeleton } from "~/shared/ui/skeleton";

/** 계정이 사라진 실명 작성자. 게시물 카드와 같은 문구를 쓴다. */
const UNKNOWN_AUTHOR = "알 수 없는 사용자";

const CARD_CLASS =
  "block w-64 max-w-full overflow-hidden rounded-2xl border bg-card text-left text-card-foreground";

/**
 * 메시지 안 게시물 카드(기능 명세 §13.21). 보는 사람이 읽을 수 없는 게시물은 서버가 빼고 돌려주므로
 * 누를 수 없는 안내 카드로 그린다. 읽기 실패는 권한 없음과 다른 문구로 그리고 다시 시도하게 한다 —
 * 잠깐의 네트워크 오류를 영구한 거부처럼 보이게 하지 않는다.
 */
export function PostPreviewCard({
  postId,
  path,
  className,
}: {
  postId: string;
  path: string;
  className?: string;
}) {
  const t = useT();
  const query = useQuery(postPreviewQuery(postId));
  const preview = query.data;
  const excerpt = useMemo(
    () =>
      !preview
        ? ""
        : preview.activityKind
          ? // 프로필 사진·커버 변경 활동은 본문이 비어 있다. 피드와 같은 문구로 대신한다.
            t(
              preview.activityKind === "avatar_changed"
                ? "프로필 사진을 바꾸었습니다."
                : "프로필 커버를 바꾸었습니다.",
            )
          : extractPostPlainText(preview.body).trim(),
    [preview, t],
  );

  if (query.isPending) {
    return (
      <div
        aria-label={t("게시물 불러오는 중")}
        className={cn(CARD_CLASS, "p-3", className)}
      >
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-1.5 h-4 w-3/4" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div
        className={cn(
          CARD_CLASS,
          "flex items-center gap-2 px-3.5 py-2.5 text-sm text-muted-foreground",
          className,
        )}
      >
        <span className="min-w-0 flex-1">
          {t("게시물을 불러오지 못했습니다")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RotateCwIcon data-icon="inline-start" />
          {t("다시 시도")}
        </Button>
      </div>
    );
  }

  if (!preview) {
    return (
      <div
        className={cn(
          CARD_CLASS,
          "flex items-center gap-2 px-3.5 py-3 text-sm text-muted-foreground",
          className,
        )}
      >
        <EyeOffIcon aria-hidden className="size-4 shrink-0" />
        {t("볼 수 없는 게시물입니다")}
      </div>
    );
  }

  // 운영진 글은 다른 게시물 화면처럼 실제 이름에 운영진 표시를 붙인다.
  const author = preview.authorName ?? preview.authorLabel ?? t(UNKNOWN_AUTHOR);
  return (
    <Link
      to={path}
      className={cn(
        CARD_CLASS,
        "transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {preview.imageUrl ? (
        <img
          src={preview.imageUrl}
          alt=""
          loading="lazy"
          className="aspect-[4/3] w-full bg-muted object-cover"
        />
      ) : null}
      <div className="flex flex-col gap-1 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <UserAvatar
            src={preview.authorAvatarUrl}
            name={author}
            size="sm"
            className="size-5"
          />
          <span className="truncate font-medium text-foreground">{author}</span>
          {preview.authorIdentity === "staff" ? (
            <StaffMark className="size-3.5" />
          ) : null}
          {preview.groupName ? (
            <span className="truncate">· {preview.groupName}</span>
          ) : null}
        </div>
        {preview.title ? (
          <p className="line-clamp-1 text-sm font-semibold">{preview.title}</p>
        ) : null}
        {excerpt ? (
          <p className="line-clamp-2 text-sm [overflow-wrap:anywhere] text-muted-foreground">
            {excerpt}
          </p>
        ) : null}
        {!preview.title && !excerpt ? (
          <p className="text-sm text-muted-foreground">
            {t("게시물 보기", undefined, "link")}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
