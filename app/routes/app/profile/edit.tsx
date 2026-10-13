import {
  data,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import { defineAppChrome, refreshShellProfile } from "~/features/app-shell";
import {
  birthdayKeys,
  loadMyEditableProfile,
  loadProfileDepartments,
  ProfileEditScreen,
  readProfileEditFailure,
  readProfileEditForm,
  rememberRenamedPubId,
  updateMyProfile,
  validateProfileEdit,
  type ProfileEditActionData,
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
    rememberRenamedPubId(profile.pub_id, pubId);
    await Promise.all([
      refreshShellProfile(),
      getQueryClient().invalidateQueries({ queryKey: birthdayKeys.all }),
    ]);
  } catch (error) {
    return data(
      { values, errors: readProfileEditFailure(error) },
      {
        status: 400,
      },
    );
  }

  // 프로필로 보내지 않고 화면이 돌아가게 한다. redirect는 history에 프로필을 하나 더 쌓아 뒤로가기가 편집 화면을 다시 연다.
  return { savedPubId: pubId };
}

/** 저장 직후 이 화면은 곧 떠난다. 다시 읽으면 공개 ID를 바꾼 경우 loader가 새 편집 주소로 보내 버린다. */
export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  const result = actionResult as ProfileEditActionData | undefined;
  if (result?.savedPubId !== undefined) return false;
  return defaultShouldRevalidate;
}

export default function ProfileEditPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <ProfileEditScreen
      profile={loaderData.profile}
      departments={loaderData.departments}
      actionData={actionData}
    />
  );
}
