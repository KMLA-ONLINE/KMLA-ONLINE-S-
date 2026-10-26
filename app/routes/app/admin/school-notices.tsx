import { data, redirect, type ClientActionFunctionArgs } from "react-router";

import {
  getAdminErrorMessage,
  getSchoolNoticeStatus,
  isAdminAccessError,
  SchoolNoticeAccountScreen,
  setSchoolNoticeAccount,
  syncSchoolNotices,
} from "~/features/admin";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { useT } from "~/shared/i18n";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "3xl",
  pullToRefresh: true,
});

export async function clientLoader() {
  try {
    return { status: await getSchoolNoticeStatus() };
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    throw error;
  }
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const form = await request.formData();
  try {
    if (form.get("intent") === "sync") {
      await syncSchoolNotices();
    } else {
      const loginId = form.get("login_id");
      const password = form.get("password");
      await setSchoolNoticeAccount(
        typeof loginId === "string" ? loginId : "",
        typeof password === "string" ? password : "",
      );
    }
    return data({ ok: true });
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    return data({ error: getAdminErrorMessage(error) }, { status: 400 });
  }
}

export default function SchoolNoticeAccountPage({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>;
}) {
  const { profile } = useAppShell();
  const t = useT();
  if (profile.role !== "admin") return null;
  return (
    <>
      <PageHeader title={t("학교 공지 계정")} back="/admin" />
      <SchoolNoticeAccountScreen {...loaderData} />
    </>
  );
}
