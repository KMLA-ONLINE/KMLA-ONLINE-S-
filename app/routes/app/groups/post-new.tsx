import { useRouteLoaderData } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import type { GroupDetail } from "~/features/groups";
import { GroupPostOverlay, resolveIdentityOptions } from "~/features/posts";
import type { clientLoader as groupLoader } from "~/routes/app/groups/detail";
import { invalidateSavedGroupPost } from "~/routes/app/groups/post-cache";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

function canCreate(group: GroupDetail): boolean {
  return (
    group.membership_state === "member" &&
    (group.posting_policy === "members" ||
      group.member_role === "owner" ||
      group.member_role === "admin" ||
      group.member_role === "manager")
  );
}

/**
 * `/groups/:slug/posts/new`.
 *
 * 자기 loader가 없다. 이 route는 그룹 route의 자식이라 부모의 loader가 언제나 먼저 돌고,
 * 그룹과 카테고리가 그 데이터에 이미 들어 있다. 여기서 다시 읽으면 글쓰기를 누를 때마다 같은
 * 조회가 두 번 나가고, 카테고리는 그룹을 기다렸다 나가므로 왕복이 줄줄이 붙는다.
 */
export default function NewGroupPostPage() {
  const parent = useRouteLoaderData<typeof groupLoader>(
    "routes/app/groups/detail",
  );
  if (!parent) {
    throw new Response("그룹을 찾을 수 없습니다.", { status: 404 });
  }

  const { group, categories } = parent;
  if (!canCreate(group))
    throw new Response("게시물을 작성할 권한이 없습니다.", { status: 403 });

  const identities = resolveIdentityOptions(
    group.identity_policy,
    group.member_role,
    Boolean(parent.anonymousActivityRestriction),
  );
  return (
    <GroupPostOverlay
      mode="create"
      slug={group.slug}
      groupName={group.name}
      groupId={group.group_id}
      categories={categories}
      identities={identities}
      anonymousActivityRestriction={parent.anonymousActivityRestriction}
      onSaved={() => invalidateSavedGroupPost(group.group_id)}
    />
  );
}
