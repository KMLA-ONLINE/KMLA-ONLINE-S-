import { useRouteLoaderData } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import type { GroupDetail } from "~/features/groups";
import {
  GroupPostOverlay,
  listGroupCategories,
  resolveIdentityOptions,
} from "~/features/posts";
import type { clientLoader as groupLoader } from "~/routes/app/groups/detail";
import type { Route } from "./+types/post-new";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const { loadGroupDetail } = await import("~/features/groups");
  const group = await loadGroupDetail(params.slug);
  if (group?.membership_state !== "member")
    throw new Response("그룹 멤버만 게시물을 작성할 수 있습니다.", {
      status: 403,
    });
  return { group, categories: await listGroupCategories(group.group_id) };
}

function canCreate(group: GroupDetail): boolean {
  return (
    group.membership_state === "member" &&
    (group.posting_policy === "members" ||
      group.member_role === "owner" ||
      group.member_role === "admin" ||
      group.member_role === "manager")
  );
}

export default function NewGroupPostPage({ loaderData }: Route.ComponentProps) {
  const parent = useRouteLoaderData<typeof groupLoader>(
    "routes/app/groups/detail",
  );
  const group = parent?.group ?? loaderData.group;
  if (!canCreate(group))
    throw new Response("게시물을 작성할 권한이 없습니다.", { status: 403 });
  const identities = resolveIdentityOptions(
    group.identity_policy,
    group.member_role,
  );
  return (
    <GroupPostOverlay
      mode="create"
      slug={group.slug}
      groupName={group.name}
      groupId={group.group_id}
      categories={loaderData.categories}
      identities={identities}
      alwaysAnonymous={group.identity_policy === "always_anonymous"}
    />
  );
}
