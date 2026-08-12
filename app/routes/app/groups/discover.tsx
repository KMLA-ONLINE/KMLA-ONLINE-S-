import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { data, redirect } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import {
  cancelGroupJoinRequest,
  discoverGroups,
  getGroupErrorMessage,
  type GroupDiscoveryCursor,
  GroupDiscoverScreen,
  hasMinimumGroupSearchLength,
  joinGroup,
  normalizeGroupSearchInput,
  requestGroupJoin,
} from "~/features/groups";
import { Button } from "~/shared/ui/button";
import type { Route } from "./+types/discover";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const rawQuery = normalizeGroupSearchInput(url.searchParams.get("q") ?? "");
  const query = hasMinimumGroupSearchLength(rawQuery) ? rawQuery : "";
  const includeJoined = url.searchParams.get("includeJoined") === "true";
  const cursor = readDiscoveryCursor(url.searchParams);

  try {
    return {
      page: await discoverGroups({ query, includeJoined, cursor }),
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
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchOpen = searchExpanded || Boolean(loaderData.query);
  if (profile.type === "teacher") return null;

  return (
    <>
      <PageHeader
        title="그룹 찾기"
        back="/groups"
        actions={
          !searchOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="그룹 검색 열기"
              onClick={() => setSearchExpanded(true)}
            >
              <SearchIcon aria-hidden />
            </Button>
          ) : null
        }
      />
      <GroupDiscoverScreen
        key={`${loaderData.query}:${loaderData.includeJoined}`}
        initialPage={loaderData.page}
        query={loaderData.query}
        includeJoined={loaderData.includeJoined}
        profileId={profile.id}
        searchOpen={searchOpen}
        focusSearch={searchExpanded}
        onSearchOpenChange={setSearchExpanded}
      />
    </>
  );
}

function readDiscoveryCursor(
  searchParams: URLSearchParams,
): GroupDiscoveryCursor | null {
  const rankValue = searchParams.get("afterRank");
  const memberCountValue = searchParams.get("afterMemberCount");
  const groupId = searchParams.get("afterId");
  if (!rankValue && !memberCountValue && !groupId) return null;

  const rank = Number(rankValue);
  const memberCount = Number(memberCountValue);
  if (
    !groupId ||
    !Number.isInteger(rank) ||
    rank < 0 ||
    rank > 2 ||
    !Number.isSafeInteger(memberCount) ||
    memberCount < 0
  ) {
    throw new Response("잘못된 그룹 페이지입니다.", { status: 400 });
  }

  return { rank, memberCount, groupId };
}
