import { Link } from "react-router";

import { UserAvatar } from "~/shared/components/user-avatar";

/**
 * 게시물 스택의 첫 카드처럼 보이는 글쓰기 진입점. 카드와 같은 프레이밍(모바일은 풀블리드,
 * `md:`부터 테두리 있는 카드)을 그대로 쓰는 것이 핵심이다 — 별개의 버튼으로 보이면 피드
 * 상단에 관련 없는 컨트롤이 하나 얹힌 것처럼 읽힌다.
 *
 * 그룹 피드와 프로필 타임라인이 같은 것을 쓴다. 가는 곳만 다르다.
 *
 * 아바타는 셸이 이미 들고 있는 값을 받아 그린다(요청이 늘지 않는다). 링크의 이름은 문구
 * 하나로 남겨야 하므로 낭독기에서는 감춘다 — "홍길동 프로필 사진 글쓰기…"로 읽히면 이 링크가
 * 무엇을 하는지가 뒤로 밀린다.
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
