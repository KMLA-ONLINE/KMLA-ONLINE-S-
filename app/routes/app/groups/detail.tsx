import { data, Outlet } from "react-router";

import { defineAppChrome, useAppShell } from "~/features/app-shell";
import {
  cancelGroupJoinRequest,
  getGroupErrorMessage,
  GroupDetailMobileHeader,
  GroupDetailScreen,
  joinGroup,
  loadGroupDetail,
  requestGroupJoin,
  setGroupPinned,
} from "~/features/groups";
import type { Route } from "./+types/detail";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
});

/**
 * `groups/:slug`. 게시물 상세(`posts/:postId`)를 자식으로 가지므로 `<Outlet />`을 그린다 —
 * 게시물을 열어도 그룹 페이지가 언마운트되지 않아 스크롤 위치와 로더 데이터가 유지된다.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const group = await loadGroupDetail(params.slug);
  if (!group) throw new Response("그룹을 찾을 수 없습니다.", { status: 404 });
  return { group };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const groupId = formData.get("groupId");
  const profileId = Number(formData.get("profileId"));
  if (typeof groupId !== "string" || !Number.isSafeInteger(profileId)) {
    return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
  }

  try {
    if (intent === "pin") {
      await setGroupPinned(
        groupId,
        profileId,
        formData.get("pinned") === "true",
      );
    } else if (intent === "join") {
      await joinGroup(groupId, profileId);
    } else if (intent === "request") {
      await requestGroupJoin(groupId, profileId);
    } else if (intent === "cancel-request") {
      await cancelGroupJoinRequest(groupId, profileId);
    } else {
      return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    }
    return data({ ok: true });
  } catch (error) {
    return data({ error: getGroupErrorMessage(error) }, { status: 400 });
  }
}

export default function GroupPage({ loaderData }: Route.ComponentProps) {
  const { profile } = useAppShell();

  return (
    <>
      <GroupDetailMobileHeader
        name={loaderData.group.name}
        iconPath={loaderData.group.icon_path}
      />
      <GroupDetailScreen
        group={loaderData.group}
        profileId={profile.id}
        isTeacher={profile.type === "teacher"}
      />
      <Outlet />
    </>
  );
}
