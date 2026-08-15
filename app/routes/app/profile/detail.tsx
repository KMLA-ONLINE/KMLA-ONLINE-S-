import { redirect } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { loadAcceptedProfile, ProfileDetail } from "~/features/profiles";
import type { Route } from "./+types/detail";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const requestedPubId = params.pubId.toLowerCase();
  const profile = await loadAcceptedProfile(requestedPubId);

  if (!profile) {
    throw new Response("프로필을 찾을 수 없습니다.", { status: 404 });
  }

  if (params.pubId !== profile.pub_id) {
    throw redirect(`/profile/${profile.pub_id}`);
  }

  return { profile };
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const { profile: viewer } = useAppShell();
  const isOwnProfile = viewer.pub_id === loaderData.profile.pub_id;

  return (
    <>
      <PageHeader title="프로필" back={!isOwnProfile} />
      <ProfileDetail profile={loaderData.profile} isOwnProfile={isOwnProfile} />
    </>
  );
}
