import { Outlet } from "react-router";

import { ScrollRegion } from "~/domains/shell/components/scroll-region";

/**
 * 집중형 레이아웃 — 탭바 없이 페이지가 스크롤한다.
 *
 * `document`와의 차이는 **탭바 하나뿐**이다. 드릴인(그룹 상세)이나 폼(그룹 생성)처럼 그 화면을
 * 끝내거나 뒤로 나가는 게 유일한 출구인 곳에 쓴다. 뒤로가기는 페이지가 `<PageHeader back />`으로
 * 제공한다.
 *
 * 레이아웃을 라우트 모듈의 `handle`이 아니라 `routes.ts`의 위치가 정하므로, "탭바는 껐는데
 * 여백 보정을 안 껐다" 같은 반쯤 어긋난 상태가 나올 수 없다.
 */
export default function FocusedLayout() {
  return (
    <ScrollRegion>
      {/* `document`와 같은 거터 규칙. 이유는 document.tsx 주석 참고. */}
      <div className="md:px-8">
        <div className="mx-auto w-full max-w-3xl md:py-6">
          <Outlet />
        </div>
      </div>
    </ScrollRegion>
  );
}
