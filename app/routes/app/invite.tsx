import { data, redirect } from "react-router";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  acceptGroupInvite,
  getGroupErrorMessage,
  getGroupInvitePreview,
  GroupInviteScreen,
} from "~/features/groups";
import type { Route } from "./+types/invite";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "2xl",
});

/**
 * `invite/:token`. 그룹 아래(`groups/...`)가 아니라 최상위에 있는 것은 의도다. 그룹 상세는
 * 주소로 그룹을 찾는데, 비공개 그룹의 행은 RLS가 비멤버에게 숨기므로 토큰을 읽어 보기도 전에
 * 404가 난다. 이 화면은 토큰만으로 시작한다.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { preview: await getGroupInvitePreview(params.token) };
}

export async function clientAction({ params }: Route.ClientActionArgs) {
  try {
    return redirect(`/groups/${await acceptGroupInvite(params.token)}`);
  } catch (error) {
    return data({ error: getGroupErrorMessage(error) }, { status: 400 });
  }
}

export default function GroupInvitePage({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader title="그룹 초대" back="/groups" />
      <GroupInviteScreen preview={loaderData.preview} />
    </>
  );
}
