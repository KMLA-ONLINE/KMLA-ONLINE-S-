import { data, redirect } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import {
  cancelGroupJoinRequest,
  discoverGroups,
  getGroupErrorMessage,
  GroupDiscoverScreen,
  joinGroup,
  requestGroupJoin,
} from "~/features/groups";
import type { Route } from "./+types/discover";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const includeJoined = url.searchParams.get("includeJoined") === "true";

  try {
    return {
      groups: await discoverGroups({ query, includeJoined }),
      query,
      includeJoined,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42501"
    ) {
      throw redirect("/groups");
    }
    throw error;
  }
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
    if (intent === "join") await joinGroup(groupId, profileId);
    else if (intent === "request") await requestGroupJoin(groupId, profileId);
    else if (intent === "cancel-request")
      await cancelGroupJoinRequest(groupId, profileId);
    else return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    return data({ ok: true });
  } catch (error) {
    return data({ error: getGroupErrorMessage(error) }, { status: 400 });
  }
}

export default function GroupDiscoverPage({
  loaderData,
}: Route.ComponentProps) {
  const { profile } = useAppShell();
  if (profile.type === "teacher") return null;

  return (
    <>
      <PageHeader title="그룹 찾기" />
      <GroupDiscoverScreen
        groups={loaderData.groups}
        query={loaderData.query}
        includeJoined={loaderData.includeJoined}
        profileId={profile.id}
      />
    </>
  );
}
