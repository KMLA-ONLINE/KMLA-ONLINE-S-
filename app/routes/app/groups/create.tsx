import { data, redirect, useNavigation } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import {
  createGroup,
  getGroupErrorMessage,
  GroupCreateForm,
  hasGroupFormErrors,
  readCreateGroupForm,
  validateCreateGroup,
  type CreateGroupErrors,
} from "~/features/groups";
import type { Route } from "./+types/create";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "2xl",
});

export async function clientAction({ request }: Route.ClientActionArgs) {
  const values = readCreateGroupForm(await request.formData());
  const errors = validateCreateGroup(values);

  if (hasGroupFormErrors(errors)) {
    return data({ errors, values }, { status: 400 });
  }

  try {
    const group = await createGroup(values);
    throw redirect(`/groups/${group.slug}`);
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      {
        errors: {
          form: getGroupErrorMessage(error),
        } satisfies CreateGroupErrors,
        values,
      },
      { status: 400 },
    );
  }
}

export default function GroupCreatePage({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const { profile } = useAppShell();
  const canCreateOfficial =
    profile.role === "admin" && profile.type !== "teacher";

  return (
    <>
      <PageHeader title="그룹 만들기" back="/groups" />
      <GroupCreateForm
        canCreateOfficial={canCreateOfficial}
        values={actionData?.values}
        errors={actionData?.errors}
        pending={navigation.state === "submitting"}
      />
    </>
  );
}
