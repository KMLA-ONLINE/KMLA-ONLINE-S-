import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { loadAcceptedProfile, ProfileDetail } from "~/features/profiles";
import type { Route } from "./+types/detail";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
});

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const profile = await loadAcceptedProfile(params.pubId);
  if (!profile)
    throw new Response("프로필을 찾을 수 없습니다.", { status: 404 });
  return { profile };
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader title={loaderData.profile.name} back />
      <ProfileDetail profile={loaderData.profile} />
    </>
  );
}
