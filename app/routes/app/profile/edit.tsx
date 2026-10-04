import { data, redirect } from "react-router";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  birthdayKeys,
  loadMyEditableProfile,
  loadProfileDepartments,
  ProfileEditScreen,
  readProfileEditFailure,
  readProfileEditForm,
  updateMyProfile,
  validateProfileEdit,
} from "~/features/profiles";
import { getQueryClient } from "~/shared/lib/query-client";
import type { Route } from "./+types/edit";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [profile, departments] = await Promise.all([
    loadMyEditableProfile(),
    loadProfileDepartments(),
  ]);

  if (!profile) {
    throw new Response("편집할 프로필을 찾을 수 없습니다.", { status: 404 });
  }

  if (params.pubId !== profile.pub_id) {
    throw redirect(`/profile/${profile.pub_id}/edit`);
  }

  return { profile, departments };
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

  let pubId: string;

  try {
    // 공개 ID를 바꿨다면 저장 전의 주소는 이미 없는 주소다. RPC가 돌려준 값으로만 옮긴다.
    pubId = await updateMyProfile(values);
    await getQueryClient().invalidateQueries({ queryKey: birthdayKeys.all });
  } catch (error) {
    return data(
      { values, errors: readProfileEditFailure(error) },
      {
        status: 400,
      },
    );
  }

  throw redirect(`/profile/${pubId}`);
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
      <ProfileEditScreen
        profile={loaderData.profile}
        departments={loaderData.departments}
        actionData={actionData}
      />
    </>
  );
}
