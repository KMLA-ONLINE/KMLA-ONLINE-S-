import { Outlet, useParams } from "react-router";

import { MessagingScreen } from "~/features/messaging";

/**
 * `immersive` 레이아웃 밑에 있는 유일한 화면. 셸은 높이만 잡아 주고 **스크롤은 이 라우트가
 * 직접 소유한다** — 방 목록과 대화창이 각자 자기 영역에서만 스크롤한다.
 *
 * 모바일에서는 방을 열면 목록이 사라지고 대화창이 전체를 차지한다(URL이 곧 화면 상태라
 * 뒤로가기가 그대로 동작한다). 데스크톱에서는 둘이 나란히 있다.
 */
export default function MessengerPage() {
  const { roomId } = useParams();

  return (
    <MessagingScreen hasRoom={Boolean(roomId)}>
      <Outlet />
    </MessagingScreen>
  );
}
