import { useOutletContext } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import {
  loadConversation,
  RoomScreen,
  type DesktopDetailsContext,
} from "~/features/messaging";
import type { Route } from "./+types/room";

// 대화방은 입력창이 바닥에 붙으므로 모바일 하단 nav를 숨긴다.
export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  scroll: "route",
});

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const conversation = await loadConversation(params.roomId);
  if (!conversation) {
    throw new Response("대화를 찾을 수 없습니다.", { status: 404 });
  }
  return { conversation };
}

/**
 * `messenger/:roomId`. 대화 목록만 스크롤하고 입력창은 바닥에 붙어 있다. `scroll: "route"`가
 * 셸의 공통 스크롤 영역을 빼서 이 배치를 보장한다.
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
