import { PageHeader } from "~/features/app-shell";
import { RoomScreen } from "~/features/messaging";

/**
 * `messenger/:roomId`. 대화 목록만 스크롤하고 입력창은 바닥에 붙어 있다. 일반 앱의 공통
 * 스크롤 컨테이너와 분리된 메신저 레이아웃이 이 배치를 보장한다.
 */
export default function MessengerRoomPage() {
  return (
    <>
      <PageHeader title="대화" back="/messenger" />
      <RoomScreen />
    </>
  );
}
