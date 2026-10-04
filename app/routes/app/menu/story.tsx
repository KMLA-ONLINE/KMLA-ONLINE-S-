import { Navigate } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { StoryEditor } from "~/features/stories/components/story-editor";
import { STORY_STALE_TIME, storyKeys } from "~/features/stories/data/cache";
import { listTodayStories } from "~/features/stories/data/queries";
import { getKoreaDateIso } from "~/shared/lib/korea-date";
import { getQueryClient } from "~/shared/lib/query-client";

import type { Route } from "./+types/story";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export async function clientLoader() {
  return {
    stories: await getQueryClient()
      .fetchQuery({
        queryKey: storyKeys.today(getKoreaDateIso()),
        queryFn: listTodayStories,
        staleTime: STORY_STALE_TIME,
      })
      .catch(() => []),
  };
}

export default function StoryPage({ loaderData }: Route.ComponentProps) {
  const { profile } = useAppShell();

  if (profile.type === "alumni") {
    return <Navigate to="/menu" replace />;
  }

  const mine =
    loaderData.stories.find((item) => item.pubId === profile.pub_id) ?? null;

  return (
    <>
      <PageHeader title={mine ? "스토리 수정" : "스토리 남기기"} back="/menu" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">
          {mine ? "스토리 수정" : "스토리 남기기"}
        </h1>

        <StoryEditor initial={mine ? mine.content : null} />
      </div>
    </>
  );
}
