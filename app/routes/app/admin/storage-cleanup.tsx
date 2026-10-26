import { redirect } from "react-router";

import {
  getStorageCleanupStatus,
  isAdminAccessError,
  StorageCleanupScreen,
} from "~/features/admin";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { useT } from "~/shared/i18n";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
  pullToRefresh: true,
});

export async function clientLoader() {
  try {
    return { status: await getStorageCleanupStatus() };
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    throw error;
  }
}

export default function StorageCleanupPage({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>;
}) {
  const { profile } = useAppShell();
  const t = useT();
  if (profile.role !== "admin") return null;
  return (
    <>
      <PageHeader title={t("파일 정리")} back="/admin" />
      <StorageCleanupScreen {...loaderData} />
    </>
  );
}
