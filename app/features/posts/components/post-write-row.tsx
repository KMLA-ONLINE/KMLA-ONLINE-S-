import { Link } from "react-router";

import { UserAvatar } from "~/shared/components/user-avatar";

/**
 * 게시물 스택의 첫 카드처럼 보이는 글쓰기 진입점. 카드와 같은 프레이밍을 써 별개 버튼처럼 보이지 않게 한다.
 * 링크 이름을 문구 하나로 남기려 아바타는 낭독기에서 감춘다.
 */
export function PostWriteRow({
  to,
  viewerName,
  viewerAvatarUrl,
  label = "글쓰기…",
}: {
  to: string;
  /** 지금 로그인한 사용자. 남의 타임라인에서도 글을 쓰는 사람은 나다. */
  viewerName: string | null;
  viewerAvatarUrl: string | null;
  label?: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 overflow-hidden rounded-none border-b-2 border-foreground/20 bg-card px-4 py-3 md:rounded-xl md:border md:border-border md:px-3 md:py-2.5"
    >
      <span className="shrink-0" aria-hidden="true">
        <UserAvatar
          src={viewerAvatarUrl}
          name={viewerName}
          className="size-9"
        />
      </span>
      <span className="flex-1 rounded-full bg-muted px-4 py-2 text-sm text-muted-foreground transition-[filter] group-hover:brightness-95">
        {label}
      </span>
    </Link>
  );
}
