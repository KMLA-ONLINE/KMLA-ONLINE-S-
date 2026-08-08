import { PenSquareIcon, SearchIcon } from "lucide-react";
import { Link } from "react-router";

import { listFeedPosts } from "~/domains/feed/data/queries";
import { PageHeader, useShellData } from "~/domains/shell";
import { Button } from "~/shared/ui/button";
import type { Route } from "./+types/feed";

/**
 * 앱의 index 라우트 — `document` 레이아웃(탭바 O, 페이지 스크롤) 밑에 있다.
 *
 * 셸에 대해 이 파일이 아는 것은 정확히 두 가지다.
 *   1. 모바일 헤더가 필요하면 `<PageHeader>`를 직접 그린다.
 *   2. 셸 데이터가 필요하면 `useShellData()`로 읽는다.
 *
 * `handle`은 없다. 여백·탭바·safe-area·스크롤 주체를 이 파일이 결정하지 않는다.
 */

// 첫 페이지는 로더가 await 한다. 이후 페이지는 useFetcher로 같은 clientLoader에 커서를 보낸다
// (AGENTS.md의 "Loaders await their data" — 스트리밍 스켈레톤이 필요한 화면에서만 예외).
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const before = new URL(request.url).searchParams.get("before");
  const posts = await listFeedPosts(before ? Number(before) : undefined);

  return { posts };
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { profile } = useShellData();
  const { posts } = loaderData;

  return (
    <>
      {/* 모바일 헤더는 이 페이지의 것이다. `hideOnScroll`도 여기서 켠다 — 긴 목록이라
          아래로 읽을 때 한 줄이라도 더 보이는 게 낫다. 이 플래그는 셸에 닿지 않는다. */}
      <PageHeader
        title="KMLA Online"
        hideOnScroll
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="검색"
              render={<Link to="/groups/discover" />}
            >
              <SearchIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="글쓰기"
              render={<Link to="/groups" />}
            >
              <PenSquareIcon />
            </Button>
          </>
        }
      />

      {/* 모바일은 좌우 여백 0이 기본이라 카드가 화면 끝까지 찬다. 여백이 필요하면
          여기에 `px-4`를 붙인다 — 셸에 축을 하나 늘리지 않는다. */}
      <div className="flex flex-col gap-3 py-3">
        <p className="px-4 text-sm text-muted-foreground">
          {profile.name}님, 안녕하세요
        </p>

        {posts.map((post) => (
          <article
            key={post.post_id}
            className="border-y bg-card p-4 md:rounded-lg md:border"
          >
            <h2 className="font-semibold">{post.title}</h2>
            <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
              {post.content}
            </p>
          </article>
        ))}

        {posts.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            아직 게시물이 없습니다.
          </p>
        ) : null}
      </div>
    </>
  );
}
