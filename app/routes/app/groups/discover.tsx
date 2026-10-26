import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { data, redirect } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import {
  cancelGroupJoinRequest,
  discoverGroups,
  getGroupErrorMessage,
  groupKeys,
  GROUP_STALE_TIME,
  type GroupDiscoveryCursor,
  GroupDiscoverScreen,
  hasMinimumGroupSearchLength,
  joinGroup,
  normalizeGroupSearchInput,
  requestGroupJoin,
} from "~/features/groups";
import { Button } from "~/shared/ui/button";
import { getQueryClient } from "~/shared/lib/query-client";
import { getCurrentLocale, translate, useT } from "~/shared/i18n";
import { resetFeed } from "~/features/feed";
import type { Route } from "./+types/discover";

/** clientLoader/clientAction은 React 밖이라 현재 언어를 직접 읽는다. */
function msg(source: string): string {
  return translate(getCurrentLocale(), source);
}

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  pullToRefresh: true,
});

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const rawQuery = normalizeGroupSearchInput(url.searchParams.get("q") ?? "");
  const query = hasMinimumGroupSearchLength(rawQuery) ? rawQuery : "";
  const includeJoined = url.searchParams.get("includeJoined") === "true";
  const cursor = readDiscoveryCursor(url.searchParams);

  try {
    return {
      page: await getQueryClient().fetchQuery({
        queryKey: groupKeys.discovery(query, includeJoined, cursor),
        queryFn: () => discoverGroups({ query, includeJoined, cursor }),
        staleTime: GROUP_STALE_TIME,
      }),
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
    return data({ error: msg("그룹을 찾을 수 없습니다.") }, { status: 400 });
  }

  try {
    if (intent === "join") await joinGroup(groupId, profileId);
    else if (intent === "request") await requestGroupJoin(groupId, profileId);
    else if (intent === "cancel-request")
      await cancelGroupJoinRequest(groupId, profileId);
    else
      return data({ error: msg("지원하지 않는 요청입니다.") }, { status: 400 });
    const queryClient = getQueryClient();
    const tasks = [
      queryClient.invalidateQueries({
        queryKey: groupKeys.home(),
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: groupKeys.discoveries(),
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: groupKeys.details(),
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: groupKeys.memberLists(groupId),
        refetchType: "none",
      }),
    ];
    if (intent === "join") tasks.push(resetFeed(queryClient));
    await Promise.all(tasks);
    return data({ ok: true });
  } catch (error) {
    return data(
      { error: getGroupErrorMessage(error, getCurrentLocale()) },
      { status: 400 },
    );
  }
}

export default function GroupDiscoverPage({
  loaderData,
}: Route.ComponentProps) {
  const t = useT();
  const { profile } = useAppShell();
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchOpen = searchExpanded || Boolean(loaderData.query);
  if (profile.type === "teacher") return null;

  return (
    <>
      <PageHeader
        title={t("그룹 찾기")}
        back="/groups"
        actions={
          !searchOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("그룹 검색 열기")}
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
    throw new Response(msg("잘못된 그룹 페이지입니다."), { status: 400 });
  }

  return { rank, memberCount, groupId };
}
