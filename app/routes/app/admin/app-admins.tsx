import {
  data,
  redirect,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
} from "react-router";

import {
  AdminReauthentication,
  AppAdminsScreen,
  getAdminErrorMessage,
  isAdminAccessError,
  isRecentAdminAuthError,
  listAdminMembers,
  normalizeAdminSearch,
  reauthenticateWithPassword,
  setAppAdmin,
} from "~/features/admin";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  const query = normalizeAdminSearch(
    new URL(request.url).searchParams.get("q"),
  );
  try {
    const [all, candidates] = await Promise.all([
      listAdminMembers(undefined, true),
      query ? listAdminMembers(query) : Promise.resolve([]),
    ]);
    return {
      needsReauthentication: false as const,
      roster: all.filter((member) => member.is_app_admin),
      candidates,
      query,
    };
  } catch (error) {
    if (isRecentAdminAuthError(error))
      return { needsReauthentication: true as const };
    if (isAdminAccessError(error)) throw redirect("/");
    throw error;
  }
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const form = await request.formData();
  try {
    if (form.get("intent") === "reauthenticate") {
      const password = form.get("password");
      if (typeof password !== "string" || !password)
        return data(
          { error: "현재 비밀번호를 입력해 주세요." },
          { status: 400 },
        );
      await reauthenticateWithPassword(password);
    } else if (form.get("intent") === "set-admin") {
      const profileId = Number(form.get("profileId"));
      if (!Number.isSafeInteger(profileId))
        return data({ error: "잘못된 대상입니다." }, { status: 400 });
      await setAppAdmin(profileId, form.get("enabled") === "true");
    } else return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    return data({ ok: true });
  } catch (error) {
    if (isRecentAdminAuthError(error)) throw redirect("/admin/app-admins");
    if (isAdminAccessError(error)) throw redirect("/");
    return data({ error: getAdminErrorMessage(error) }, { status: 400 });
  }
}

export default function AppAdminsPage({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>;
}) {
  const { profile } = useAppShell();
  if (profile.role !== "admin") return null;
  return (
    <>
      <PageHeader title="앱 관리자" back="/admin" />
      {loaderData.needsReauthentication ? (
        <AdminReauthentication />
      ) : (
        <AppAdminsScreen
          roster={loaderData.roster}
          candidates={loaderData.candidates}
          query={loaderData.query}
        />
      )}
    </>
  );
}
