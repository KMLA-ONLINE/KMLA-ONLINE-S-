import { redirect } from "react-router";

import { isAdminAccessError, listRoster, RosterScreen } from "~/features/admin";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

export async function clientLoader() {
  try {
    return { members: await listRoster() };
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    throw error;
  }
}

export default function AdminMembersPage({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>;
}) {
  const { profile } = useAppShell();
  if (profile.role !== "admin") return null;
  return (
    <>
      <PageHeader title="전체 인원" back="/admin" />
      <RosterScreen members={loaderData.members} />
    </>
  );
}
