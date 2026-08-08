import { Outlet } from "react-router";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
});

/**
 * `groups/:pubId`. 게시물 상세(`posts/:postId`)를 자식으로 가지므로 `<Outlet />`을 그린다 —
 * 게시물을 열어도 그룹 페이지가 언마운트되지 않아 스크롤 위치와 로더 데이터가 유지된다.
 */
export default function GroupPage() {
  return (
    <>
      <PageHeader title="그룹" back />
      <StubPage
        title="그룹"
        description="그룹 상세와 게시물 목록이 들어갑니다."
      />
      <Outlet />
    </>
  );
}
