import { data, Outlet, redirect, replace } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import {
  createPostListRevalidation,
  deleteProfilePost,
  getPostErrorMessage,
  listProfilePosts,
} from "~/features/posts";
import {
  loadAcceptedProfile,
  ProfileDetail,
  renamedPubId,
} from "~/features/profiles";
import type { Route } from "./+types/detail";
import { invalidateDeletedProfilePost } from "~/routes/app/profile/post-cache";
import { getCurrentLocale, translate } from "~/shared/i18n";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

/**
 * 이 loader는 검색 파라미터를 읽지 않는다. 그래도 규칙이 필요한 이유는, 타임라인 게시물의
 * 이미지 뷰어가 `?image=`를 붙이기 때문이다 — 다시 읽으면 새 첫 페이지가 내려오고
 * `ProfilePostsPanel`이 "더 보기"로 쌓은 페이지를 전부 버린다.
 */
export const shouldRevalidate = createPostListRevalidation([], {
  detailParent: /^\/profile\/[^/]+/,
});

/**
 * `profile/:pubId`. 게시물 상세(`posts/:postId`)를 자식으로 가지므로 `<Outlet />`을 그린다 —
 * 게시물을 열어도 프로필이 언마운트되지 않아 스크롤 위치와 로더 데이터가 유지된다.
 */
export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs) {
  const requestedPubId = params.pubId.toLowerCase();
  const isProfilePage =
    new URL(request.url).pathname === `/profile/${params.pubId}`;
  // 타임라인 RPC도 공개 ID를 받으므로 둘이 나란히 나간다. 프로필을 먼저 기다렸다가 그 숫자
  // ID로 게시물을 부르면 화면 하나에 왕복이 두 번 쌓인다.
  const postsRequest = listProfilePosts(requestedPubId);
  // 게시물 상세로 바로 들어오면 타임라인은 그 뒤에 깔릴 뿐이라 기다리지 않는다. 실패는 상세를
  // 덮지 않도록 null로 받는다. catch는 await보다 먼저 붙여 처리되지 않은 rejection을 막는다.
  // 글쓰기·수정 화면으로 바로 들어와도 받는다. 편집기를 취소로 닫으면 부모를 다시 읽지 않아서다.
  const deferredPosts = postsRequest.catch(() => null);
  const [profile, loadedPosts] = await Promise.all([
    loadAcceptedProfile(requestedPubId),
    isProfilePage ? postsRequest : null,
  ]);
  const posts = loadedPosts ?? deferredPosts;

  if (!profile) {
    // 공개 ID를 바꾸기 전 주소로 뒤로 온 것이면 새 주소가 이 기록 항목을 차지한다.
    const renamed = renamedPubId(requestedPubId);
    if (renamed) {
      const { pathname, search } = new URL(request.url);
      throw replace(
        pathname.replace(/^\/profile\/[^/]+/, `/profile/${renamed}`) + search,
      );
    }
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
    return data(
      { error: translate(getCurrentLocale(), "지원하지 않는 요청입니다.") },
      { status: 400 },
    );
  }
  const postId = formData.get("postId");
  if (typeof postId !== "string") {
    return data(
      { error: translate(getCurrentLocale(), "게시물을 찾을 수 없습니다.") },
      { status: 400 },
    );
  }
  try {
    // 카드의 ⋯ 메뉴에서 지우는 경로. 게시물 상세 route에도 같은 삭제가 있지만 그쪽은 지운 뒤
    // 프로필로 redirect한다 — 여기서는 이미 프로필에 있으므로 revalidate로 충분하다.
    await deleteProfilePost(postId);
    invalidateDeletedProfilePost(postId);
    return data({ ok: true });
  } catch (error) {
    return data(
      { error: getPostErrorMessage(error, getCurrentLocale()) },
      { status: 400 },
    );
  }
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const { profile: viewer } = useAppShell();
  const isOwnProfile = viewer.pub_id === loaderData.profile.pub_id;

  return (
    <>
      {/* 모바일은 하단 탭도 전역 머리말도 없어, 이 머리말이 프로필을 빠져나가는 유일한 손잡이다. */}
      <PageHeader title={loaderData.profile.name} back />
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
