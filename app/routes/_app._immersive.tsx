import { Outlet } from "react-router";

/**
 * 앱형 레이아웃 — 고정 높이. 스크롤은 라우트가 자기 패널 안에서 직접 관리한다.
 *
 * 메신저처럼 "문서"가 아니라 "화면"인 곳에 쓴다: 메시지 목록은 자기 영역에서 스크롤하고
 * 입력창은 바닥에 붙어 있어야 하며, 페이지 전체가 스크롤하면 안 된다.
 *
 * 문서형과 앱형을 불리언 하나로 한 껍데기에 욱여넣으면 여백·탭바 간격·safe-area가 전부 그 값에
 * 조건부로 엮인다. 두 종류는 애초에 다른 레이아웃이고, 여기서는 다른 파일이다.
 *
 * 이 레이아웃은 여백도 컨테이너도 주지 않는다 — 패널 배치는 라우트의 일이다.
 */
export default function ImmersiveLayout() {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <Outlet />
    </div>
  );
}
