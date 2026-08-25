import { useRouteLoaderData } from "react-router";

import { defineAppChrome, useAppShell } from "~/features/app-shell";
import { ProfilePostEditor } from "~/features/posts";
import type { clientLoader as profileLoader } from "~/routes/app/profile/detail";
import { invalidateSavedProfilePost } from "~/routes/app/profile/post-cache";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

/**
 * `/profile/:pubId/posts/new`.
 *
 * 자기 loader가 없다. 이 route는 프로필 route의 자식이라 부모의 loader가 언제나 먼저 돌고,
 * 타임라인 당사자는 그 데이터에 이미 들어 있다. 여기서 프로필을 다시 읽으면 글쓰기를 누를
 * 때마다 같은 조회와 아바타 서명이 한 번씩 더 나간다.
 */
export default function NewProfilePostPage() {
  const { profile: viewer } = useAppShell();
  const parent = useRouteLoaderData<typeof profileLoader>(
    "routes/app/profile/detail",
  );
  if (!parent) {
    throw new Response("프로필을 찾을 수 없습니다.", { status: 404 });
  }

  const timeline = parent.profile;
  const isOwnTimeline = viewer.pub_id === timeline.pub_id;

  // 클라이언트 판정은 UX용이다. 실제 차단은 `create_profile_post`가 타임라인 당사자의
  // 현재 허용 값을 다시 보고 한다(기능 명세 §8.4).
  if (!isOwnTimeline && !timeline.allow_timeline_posts) {
    throw new Response("이 타임라인에는 글을 쓸 수 없습니다.", { status: 403 });
  }

  return (
    <ProfilePostEditor
      mode="create"
      timelinePubId={timeline.pub_id}
      timelineName={timeline.name}
      canChooseVisibility={isOwnTimeline}
      onSaved={invalidateSavedProfilePost}
    />
  );
}
