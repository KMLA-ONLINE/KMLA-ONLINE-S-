import {
  data,
  redirect,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
} from "react-router";

import {
  getAdminErrorMessage,
  GongangManagersScreen,
  isAdminAccessError,
  listAcceptedUsers,
  normalizeAdminSearch,
  setGongangManager,
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
      listAcceptedUsers(undefined, true),
      query ? listAcceptedUsers(query) : Promise.resolve([]),
    ]);
    return {
      managers: all.filter((user) => user.has_gongang_manage),
      candidates,
      query,
    };
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    throw error;
  }
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const form = await request.formData();
  const profileId = Number(form.get("profileId"));
  if (form.get("intent") !== "set-manager" || !Number.isSafeInteger(profileId))
    return data({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    await setGongangManager(profileId, form.get("enabled") === "true");
    return data({ ok: true });
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    return data({ error: getAdminErrorMessage(error) }, { status: 400 });
  }
}

export default function GongangManagersPage({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>;
}) {
  const { profile } = useAppShell();
  if (profile.role !== "admin") return null;
  return (
    <>
      <PageHeader title="공강 관리자" back="/admin" />
      <GongangManagersScreen {...loaderData} />
    </>
  );
}
