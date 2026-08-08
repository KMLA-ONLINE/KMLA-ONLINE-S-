import { Outlet } from "react-router";

import { MobileTabBar, ScrollRegion } from "~/features/app-shell";

/**
 * 문서형 레이아웃 — 하단 탭바가 있고 페이지가 스크롤한다.
 *
 * 앱의 기본값이다. 피드, 알림, 메뉴, 그룹 목록, 동아리, 관리자, 내 프로필처럼 "탭 하나에
 * 해당하는 목적지"가 여기 들어간다.
 *
 * `focused`와의 차이는 **탭바 하나뿐**이다.
 *
 * 모바일 좌우 여백은 0이다. 카드가 화면 가장자리까지 차는 게 모바일 기본이고, 여백이 필요한
 * 페이지가 자기 콘텐츠에 `px-4`를 붙인다.
 */
export default function DocumentLayout() {
  return (
    <>
      <ScrollRegion>
        {/* 바깥 div = 좌우 거터, 안쪽 div = 읽기 폭.
            둘을 나눈 이유: 여백을 `max-w-3xl`과 같은 상자에 두면 border-box라 여백이 글 너비를
            깎을 뿐, 상자를 사이드바에서 떼어 놓지 못한다. 태블릿(~834px)에서 가용폭이
            읽기 폭과 거의 같아지면 `mx-auto`가 벌릴 게 없어 카드가 레일에 붙는다.
            분리해 두면 좁을 때는 거터가, 넓을 때는 읽기 폭이 이긴다. */}
        <div className="md:px-8">
          <div className="mx-auto w-full max-w-3xl md:py-6">
            <Outlet />
          </div>
        </div>
      </ScrollRegion>

      <MobileTabBar className="md:hidden" />
    </>
  );
}
