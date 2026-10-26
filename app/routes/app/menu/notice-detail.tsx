import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { getCurrentLocale, translate, useT } from "~/shared/i18n";
import {
  getSchoolNotice,
  SchoolNoticeDetailScreen,
} from "~/features/school-notices";

import type { Route } from "./+types/notice-detail";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "3xl",
});

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const postId = Number(params.postId);
  const notice = Number.isSafeInteger(postId)
    ? await getSchoolNotice(postId)
    : null;
  if (!notice)
    throw new Response(
      translate(getCurrentLocale(), "공지를 찾을 수 없습니다."),
      { status: 404 },
    );
  return { notice };
}

export default function SchoolNoticeDetailPage({
  loaderData,
}: Route.ComponentProps) {
  const t = useT();
  return (
    <>
      <PageHeader title={t("학교 공지")} back="/menu/notices" />
      <SchoolNoticeDetailScreen notice={loaderData.notice} />
    </>
  );
}
