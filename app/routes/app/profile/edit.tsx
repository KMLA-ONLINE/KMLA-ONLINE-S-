import { data, redirect } from "react-router";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  loadMyEditableProfile,
  ProfileEditScreen,
  readProfileEditForm,
  updateMyProfile,
  validateProfileEdit,
} from "~/features/profiles";
import type { Route } from "./+types/edit";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "4xl",
});

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const profile = await loadMyEditableProfile();

  if (!profile) {
    throw new Response("편집할 프로필을 찾을 수 없습니다.", { status: 404 });
  }

  if (params.pubId !== profile.pub_id) {
    throw redirect(`/profile/${profile.pub_id}/edit`);
  }

  return { profile };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const profile = await loadMyEditableProfile();

  if (!profile) {
    throw new Response("편집할 프로필을 찾을 수 없습니다.", { status: 404 });
  }

  const values = {
    ...readProfileEditForm(await request.formData()),
    cohort: profile.cohort,
  };
  const errors = validateProfileEdit(values, profile.type);

  if (Object.keys(errors).length > 0) {
    return data({ values, errors }, { status: 400 });
  }

  try {
    await updateMyProfile(values);
  } catch {
    return data(
      {
        values,
        errors: {
          form: "프로필을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.",
        },
      },
      { status: 400 },
    );
  }

  throw redirect(`/profile/${profile.pub_id}`);
}

export default function ProfileEditPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <>
      <PageHeader
        title="프로필 편집"
        back={`/profile/${loaderData.profile.pub_id}`}
      />
      <ProfileEditScreen profile={loaderData.profile} actionData={actionData} />
    </>
  );
}
