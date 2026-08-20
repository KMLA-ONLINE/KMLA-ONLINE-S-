import { data, Outlet, redirect } from "react-router";

import { defineAppChrome, useAppShell } from "~/features/app-shell";
import {
  deleteProfilePost,
  getPostErrorMessage,
  listProfilePosts,
} from "~/features/posts";
import { loadAcceptedProfile, ProfileDetail } from "~/features/profiles";
import type { Route } from "./+types/detail";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "5xl",
});

/**
 * `profile/:pubId`. 게시물 상세(`posts/:postId`)를 자식으로 가지므로 `<Outlet />`을 그린다 —
 * 게시물을 열어도 프로필이 언마운트되지 않아 스크롤 위치와 로더 데이터가 유지된다.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const requestedPubId = params.pubId.toLowerCase();
  // 타임라인 RPC도 공개 ID를 받으므로 둘이 나란히 나간다. 프로필을 먼저 기다렸다가 그 숫자
  // ID로 게시물을 부르면 화면 하나에 왕복이 두 번 쌓인다.
  const [profile, posts] = await Promise.all([
    loadAcceptedProfile(requestedPubId),
    listProfilePosts(requestedPubId),
  ]);

  if (!profile) {
    throw new Response("프로필을 찾을 수 없습니다.", { status: 404 });
  }

  if (params.pubId !== profile.pub_id) {
    throw redirect(`/profile/${profile.pub_id}`);
  }

  return { profile, posts };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  if (formData.get("intent") !== "delete-post") {
    return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
  }
  const postId = formData.get("postId");
  if (typeof postId !== "string") {
    return data({ error: "게시물을 찾을 수 없습니다." }, { status: 400 });
  }
  try {
    // 카드의 ⋯ 메뉴에서 지우는 경로. 게시물 상세 route에도 같은 삭제가 있지만 그쪽은 지운 뒤
    // 프로필로 redirect한다 — 여기서는 이미 프로필에 있으므로 revalidate로 충분하다.
    await deleteProfilePost(postId);
    return data({ ok: true });
  } catch (error) {
    return data({ error: getPostErrorMessage(error) }, { status: 400 });
  }
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const { profile: viewer } = useAppShell();
  const isOwnProfile = viewer.pub_id === loaderData.profile.pub_id;

  return (
    <>
      <ProfileDetail
        profile={loaderData.profile}
        isOwnProfile={isOwnProfile}
        viewerName={viewer.name}
        viewerAvatarUrl={viewer.avatar_url}
        posts={loaderData.posts}
      />
      <Outlet />
    </>
  );
}
