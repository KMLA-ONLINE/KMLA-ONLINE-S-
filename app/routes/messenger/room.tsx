import {
  useOutletContext,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import {
  openConversation,
  RoomScreen,
  type DesktopDetailsContext,
} from "~/features/messaging";
import { getQueryClient } from "~/shared/lib/query-client";
import type { Route } from "./+types/room";

// 대화방은 입력창이 바닥에 붙으므로 모바일 하단 nav를 숨긴다.
export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  scroll: "route",
});

/**
 * 같은 대화방 안에서는 loader를 다시 돌리지 않는다. 사진 뷰어의 `?image=`처럼 주소의 쿼리만 바뀌어도
 * 다시 돌면 불러온 앞선 페이지를 버리고 최신 페이지부터 다시 시작한다. 새 메시지는 Realtime 신호와
 * 따라잡기가 맡는다.
 */
export function shouldRevalidate({
  currentParams,
  nextParams,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return currentParams.roomId === nextParams.roomId
    ? false
    : defaultShouldRevalidate;
}

// 다시 들어온 방은 남은 cache로 기다리지 않고 연다.
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const conversation = await openConversation(getQueryClient(), params.roomId);
  if (!conversation) {
    throw new Response("채팅을 찾을 수 없습니다.", { status: 404 });
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
