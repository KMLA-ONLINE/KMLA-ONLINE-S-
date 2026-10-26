import { data, redirect, type ClientActionFunctionArgs } from "react-router";

import {
  getAdminErrorMessage,
  isAdminAccessError,
  liftSuspension,
  listRoster,
  RosterScreen,
  suspendProfile,
} from "~/features/admin";
import { reauthenticateWithPassword } from "~/features/auth";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { getCurrentLocale, translate, useT } from "~/shared/i18n";

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

/** 이용 정지와 해제(§16.11). 매번 현재 비밀번호로 다시 확인한 뒤 적용한다. */
export async function clientAction({ request }: ClientActionFunctionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");
  const profileId = Number(form.get("profileId"));
  const password = form.get("password");
  const reason = form.get("reason");
  if (intent !== "suspend" && intent !== "lift")
    return data(
      { error: translate(getCurrentLocale(), "지원하지 않는 요청입니다.") },
      { status: 400 },
    );
  if (!Number.isSafeInteger(profileId))
    return data(
      { error: translate(getCurrentLocale(), "잘못된 대상입니다.") },
      { status: 400 },
    );
  if (typeof password !== "string" || !password)
    return data(
      {
        error: translate(getCurrentLocale(), "현재 비밀번호를 입력해 주세요."),
      },
      { status: 400 },
    );

  let days: number | null = null;
  if (intent === "suspend" && form.get("indefinite") !== "on") {
    days = Number(form.get("days"));
    if (!Number.isInteger(days))
      return data(
        {
          error: translate(
            getCurrentLocale(),
            "기간은 1~180일로 입력해 주세요.",
          ),
        },
        { status: 400 },
      );
  }

  try {
    await reauthenticateWithPassword(password);
    if (intent === "suspend")
      await suspendProfile(
        profileId,
        typeof reason === "string" ? reason : "",
        days,
      );
    else await liftSuspension(profileId);
    return data({ ok: true });
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    return data({ error: getAdminErrorMessage(error) }, { status: 400 });
  }
}

export default function AdminMembersPage({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>;
}) {
  const { profile } = useAppShell();
  const t = useT();
  if (profile.role !== "admin") return null;
  return (
    <>
      <PageHeader title={t("전체 인원")} back="/admin" />
      <RosterScreen members={loaderData.members} />
    </>
  );
}
