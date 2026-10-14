import { data, redirect, type ClientActionFunctionArgs } from "react-router";

import {
  AdminContactsScreen,
  getAdminErrorMessage,
  isAdminAccessError,
  replaceAdminContacts,
} from "~/features/admin";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { listAdminContacts, parseAdminContacts } from "~/features/support";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "2xl",
});

/** 연락처는 공개 정보라 읽기에는 권한 확인이 없다. 저장 RPC가 앱 관리자를 확인한다. */
export async function clientLoader() {
  return { contacts: await listAdminContacts() };
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const form = await request.formData();
  const raw = form.get("contacts");
  const parsed = parseAdminContacts(typeof raw === "string" ? raw : "");
  if (!parsed.ok)
    return data(
      "errors" in parsed
        ? { error: "입력을 확인해 주세요.", rowErrors: parsed.errors }
        : { error: parsed.form },
      { status: 400 },
    );
  try {
    await replaceAdminContacts(parsed.contacts);
    return data({ ok: true });
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    return data({ error: getAdminErrorMessage(error) }, { status: 400 });
  }
}

export default function AdminContactsPage({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>;
}) {
  const { profile } = useAppShell();
  if (profile.role !== "admin") return null;
  return (
    <>
      <PageHeader title="관리자 연락처" back="/admin" />
      <AdminContactsScreen contacts={loaderData.contacts} />
    </>
  );
}
