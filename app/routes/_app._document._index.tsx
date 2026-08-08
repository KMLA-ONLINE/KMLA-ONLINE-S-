import { PenSquareIcon, SearchIcon } from "lucide-react";
import { Link } from "react-router";

import { PageHeader, useAppShell } from "~/features/app-shell";
import { FeedScreen, listFeedPosts } from "~/features/feed";
import { Button } from "~/shared/ui/button";
import type { Route } from "./+types/_app._document._index";

/**
 * 앱의 index 라우트 — `document` 레이아웃(탭바 O, 페이지 스크롤) 밑에 있다.
 *
 * 셸에 대해 이 파일이 아는 것은 정확히 두 가지다.
 *   1. 모바일 헤더가 필요하면 `<PageHeader>`를 직접 그린다.
 *   2. 셸 데이터가 필요하면 `useAppShell()`로 읽는다.
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
  const { profile } = useAppShell();
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

      <FeedScreen posts={posts} profileName={profile.name} />
    </>
  );
}
