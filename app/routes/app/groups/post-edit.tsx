import { data, redirect, useRouteLoaderData } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import {
  getGroupPost,
  getPostErrorMessage,
  GroupPostOverlay,
  hasPostFormErrors,
  listGroupCategories,
  readPostForm,
  updateGroupPost,
  validatePostForm,
} from "~/features/posts";
import type { clientLoader as groupLoader } from "~/routes/app/groups/detail";
import type { Route } from "./+types/post-edit";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const post = await getGroupPost(params.postId);
  if (!post) throw new Response("게시물을 찾을 수 없습니다.", { status: 404 });
  if (!post.can_edit)
    throw new Response("게시물을 수정할 권한이 없습니다.", { status: 403 });
  return { post, categories: await listGroupCategories(post.group_id) };
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
    await updateGroupPost(params.postId, values);
    throw redirect(`/groups/${params.slug}/posts/${params.postId}`);
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { errors: { form: getPostErrorMessage(error) }, values },
      { status: 400 },
    );
  }
}

export default function EditGroupPostPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const parent = useRouteLoaderData<typeof groupLoader>(
    "routes/app/groups/detail",
  );
  if (
    parent?.group.membership_state !== "member" ||
    loaderData.post.group_id !== parent.group.group_id
  )
    throw new Response("게시물을 수정할 권한이 없습니다.", { status: 403 });
  return (
    <GroupPostOverlay
      mode="edit"
      slug={parent.group.slug}
      groupName={parent.group.name}
      groupId={parent.group.group_id}
      categories={loaderData.categories}
      post={loaderData.post}
      values={actionData?.values}
      errors={actionData?.errors}
    />
  );
}
