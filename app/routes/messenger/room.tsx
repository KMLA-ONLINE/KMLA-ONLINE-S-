import { useOutletContext } from "react-router";

import {
  loadConversation,
  RoomScreen,
  type DesktopDetailsContext,
} from "~/features/messaging";
import type { Route } from "./+types/room";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const conversation = await loadConversation(params.roomId);
  if (!conversation) {
    throw new Response("대화를 찾을 수 없습니다.", { status: 404 });
  }
  return { conversation };
}

/**
 * `messenger/:roomId`. 대화 목록만 스크롤하고 입력창은 바닥에 붙어 있다. 일반 앱의 공통
 * 스크롤 컨테이너와 분리된 메신저 레이아웃이 이 배치를 보장한다.
 */
export default function MessengerRoomPage({
  loaderData,
}: Route.ComponentProps) {
  const { desktopDetailsOpen, setDesktopDetailsOpen } =
    useOutletContext<DesktopDetailsContext>();

  return (
    <RoomScreen
      key={loaderData.conversation.id}
      conversation={loaderData.conversation}
      desktopDetailsOpen={desktopDetailsOpen}
      onDesktopDetailsOpenChange={setDesktopDetailsOpen}
    />
  );
}
