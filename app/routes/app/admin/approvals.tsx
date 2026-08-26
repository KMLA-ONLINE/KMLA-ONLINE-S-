import {
  data,
  redirect,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
} from "react-router";

import {
  ApprovalsScreen,
  getAdminErrorMessage,
  isAdminAccessError,
  listApplications,
  reviewApplications,
  unblockApplication,
} from "~/features/admin";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { birthdayKeys } from "~/features/profiles";
import { getQueryClient } from "~/shared/lib/query-client";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

function pageFrom(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  const searchParams = new URL(request.url).searchParams;
  const pendingPage = pageFrom(searchParams.get("pendingPage"));
  const blockedPage = pageFrom(searchParams.get("blockedPage"));
  try {
    const [pending, blocked] = await Promise.all([
      listApplications("pending", (pendingPage - 1) * 200),
      listApplications("blocked", (blockedPage - 1) * 200),
    ]);
    return { pending, blocked, pendingPage, blockedPage };
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    throw error;
  }
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");
  const ids = form.getAll("profileId").map(Number);
  if (
    !ids.length ||
    ids.length > 200 ||
    ids.some((id) => !Number.isSafeInteger(id))
  )
    return data({ error: "1명에서 200명까지 선택해 주세요." }, { status: 400 });
  try {
    if (intent === "review") {
      const status = form.get("status");
      if (status !== "accepted" && status !== "blocked")
        return data({ error: "지원하지 않는 처리입니다." }, { status: 400 });
      await reviewApplications(ids, status);
    } else if (intent === "unblock" && ids.length === 1)
      await unblockApplication(ids[0]);
    else return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    await getQueryClient().invalidateQueries({ queryKey: birthdayKeys.all });
    return data({ ok: true });
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    return data({ error: getAdminErrorMessage(error) }, { status: 400 });
  }
}

export default function AdminApprovalsPage({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>;
}) {
  const { profile } = useAppShell();
  if (profile.role !== "admin") return null;
  return (
    <>
      <PageHeader title="가입 승인" back="/admin" />
      <ApprovalsScreen {...loaderData} />
    </>
  );
}
