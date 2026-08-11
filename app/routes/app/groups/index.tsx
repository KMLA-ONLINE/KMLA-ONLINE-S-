import { data } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import {
  cancelGroupJoinRequest,
  getGroupErrorMessage,
  GroupHomeScreen,
  joinGroup,
  loadGroupHome,
  requestGroupJoin,
  setGroupPinned,
} from "~/features/groups";
import type { Route } from "./+types/index";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export async function clientLoader() {
  return { groups: await loadGroupHome() };
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

export default function GroupListPage({ loaderData }: Route.ComponentProps) {
  const { profile } = useAppShell();

  return (
    <>
      <PageHeader title="그룹" />
      <GroupHomeScreen
        groups={loaderData.groups}
        isTeacher={profile.type === "teacher"}
        profileId={profile.id}
      />
    </>
  );
}
