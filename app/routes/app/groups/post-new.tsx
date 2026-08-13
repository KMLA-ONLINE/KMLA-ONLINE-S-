import { data, redirect, useRouteLoaderData } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import type { GroupDetail } from "~/features/groups";
import {
  createGroupPost,
  getPostErrorMessage,
  GroupPostOverlay,
  hasPostFormErrors,
  listGroupCategories,
  readPostForm,
  validatePostForm,
  type PostIdentity,
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

export async function clientAction({
  request,
  params,
}: Route.ClientActionArgs) {
  const values = readPostForm(await request.formData());
  const errors = validatePostForm(values);
  if (hasPostFormErrors(errors))
    return data({ errors, values }, { status: 400 });
  try {
    const { loadGroupDetail } = await import("~/features/groups");
    const group = await loadGroupDetail(params.slug);
    if (!group || !canCreate(group))
      return data(
        { errors: { form: "게시물을 작성할 권한이 없습니다." }, values },
        { status: 403 },
      );
    const postId = await createGroupPost(group.group_id, values);
    throw redirect(`/groups/${params.slug}/posts/${postId}`);
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { errors: { form: getPostErrorMessage(error) }, values },
      { status: 400 },
    );
  }
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

export default function NewGroupPostPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const parent = useRouteLoaderData<typeof groupLoader>(
    "routes/app/groups/detail",
  );
  const group = parent?.group ?? loaderData.group;
  if (!canCreate(group))
    throw new Response("게시물을 작성할 권한이 없습니다.", { status: 403 });
  const identities: PostIdentity[] =
    group.identity_policy === "always_anonymous"
      ? ["anonymous"]
      : group.identity_policy === "optional_anonymous"
        ? ["identified", "anonymous"]
        : ["identified"];
  if (group.member_role && group.member_role !== "member")
    identities.push("staff");
  return (
    <GroupPostOverlay
      mode="create"
      slug={group.slug}
      groupName={group.name}
      groupId={group.group_id}
      categories={loaderData.categories}
      values={actionData?.values}
      errors={actionData?.errors}
      identities={identities}
      alwaysAnonymous={group.identity_policy === "always_anonymous"}
    />
  );
}
