import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { data, Link, type ShouldRevalidateFunctionArgs } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import {
  cancelGroupJoinRequest,
  getGroupErrorMessage,
  groupHomeQuery,
  groupKeys,
  GroupHomeScreen,
  type GroupHomeItem,
  joinGroup,
  requestGroupJoin,
  setGroupPinned,
} from "~/features/groups";
import type { Route } from "./+types/index";
import { Button } from "~/shared/ui/button";
import { getQueryClient } from "~/shared/lib/query-client";
import { resetFeed } from "~/features/feed";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  pullToRefresh: true,
});

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod !== "GET") return true;
  if (currentUrl.href === nextUrl.href) return true;
  if (currentUrl.pathname !== nextUrl.pathname) return true;

  const current = new URLSearchParams(currentUrl.searchParams);
  const next = new URLSearchParams(nextUrl.searchParams);
  current.delete("tab");
  next.delete("tab");
  return current.toString() !== next.toString();
}

/**
 * 캐시가 있으면 2분이 지났어도 기다리지 않고 그린다. 다시 읽기는 화면의 `useQuery`가 뒤에서 맡는다.
 *
 * 무효화된 캐시만은 기다린다. 무효화는 가입·고정처럼 내가 방금 바꾼 것이 있다는 표시라, 옛 목록을
 * 먼저 그리면 방금 한 일이 되돌아간 것처럼 보였다가 바뀐다. 당겨서 새로고침도 이 경로다.
 */
export async function clientLoader() {
  const queryClient = getQueryClient();
  const cached = queryClient.getQueryState<GroupHomeItem[]>(groupKeys.home());

  if (cached?.data && !cached.isInvalidated) return { groups: cached.data };

  return { groups: await queryClient.query(groupHomeQuery()) };
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
    const queryClient = getQueryClient();
    const tasks = [
      queryClient.invalidateQueries({
        queryKey: groupKeys.home(),
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: groupKeys.details(),
        refetchType: "none",
      }),
    ];
    if (intent !== "pin") {
      tasks.push(
        queryClient.invalidateQueries({
          queryKey: groupKeys.discoveries(),
          refetchType: "none",
        }),
        queryClient.invalidateQueries({
          queryKey: groupKeys.memberLists(groupId),
          refetchType: "none",
        }),
      );
    }
    if (intent === "join") tasks.push(resetFeed(queryClient));
    await Promise.all(tasks);
    return data({ ok: true });
  } catch (error) {
    return data({ error: getGroupErrorMessage(error) }, { status: 400 });
  }
}

export default function GroupListPage({ loaderData }: Route.ComponentProps) {
  const { profile } = useAppShell();
  const { data: groups = loaderData.groups } = useQuery(groupHomeQuery());

  return (
    <>
      <PageHeader
        title="그룹"
        actions={
          <Button
            variant="ghost"
            size="icon"
            nativeButton={false}
            aria-label="그룹 만들기"
            render={<Link to="/groups/create" />}
          >
            <PlusIcon />
          </Button>
        }
      />
      <GroupHomeScreen
        groups={groups}
        isTeacher={profile.type === "teacher"}
        profileId={profile.id}
      />
    </>
  );
}
