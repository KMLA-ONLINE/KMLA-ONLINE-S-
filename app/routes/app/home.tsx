import { MessagesSquareIcon, SearchIcon } from "lucide-react";
import { Link } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { FeedScreen, listFeedPosts } from "~/features/feed";
import { Button } from "~/shared/ui/button";
import type { Route } from "./+types/home";

/**
 * 앱의 index 라우트. 전역 chrome은 아래 handle에서 명시한다.
 *
 * 셸에 대해 이 파일이 아는 것은 정확히 두 가지다.
 *   1. 모바일 헤더가 필요하면 `<PageHeader>`를 직접 그린다.
 *   2. 셸 데이터가 필요하면 `useAppShell()`로 읽는다.
 *
 * 페이지 헤더는 화면 콘텐츠라 이 설정과 별도로 페이지가 직접 그린다.
 */

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

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
      {/* 긴 목록에서는 페이지 헤더만 별도로 자동 숨김한다. */}
      <PageHeader
        title="KMLA Online"
        hideOnScroll
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              nativeButton={false}
              aria-label="검색"
              render={<Link to="/groups/discover" />}
            >
              <SearchIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              nativeButton={false}
              aria-label="메시지"
              render={<Link to="/messenger" />}
            >
              <MessagesSquareIcon />
            </Button>
          </>
        }
      />

      <FeedScreen posts={posts} profileName={profile.name} />
    </>
  );
}
