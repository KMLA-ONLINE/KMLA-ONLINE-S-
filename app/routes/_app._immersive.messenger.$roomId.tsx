import { PageHeader } from "~/features/app-shell";
import { RoomScreen } from "~/features/messaging";

/**
 * `messenger/:roomId`. 대화 목록만 스크롤하고 입력창은 바닥에 붙어 있다 — `document`/`focused`의
 * 스크롤 컨테이너로는 만들 수 없는 배치라 `immersive`가 따로 있는 것이다.
 */
export default function MessengerRoomPage() {
  return (
    <>
      {/* 모바일에서만 보인다. 데스크톱은 오른쪽 패널에 방 제목이 따로 붙는다. */}
      <PageHeader title="대화" back="/messenger" />
      <RoomScreen />
    </>
  );
}
