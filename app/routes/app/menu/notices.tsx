import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  listSchoolNotices,
  SchoolNoticesScreen,
} from "~/features/school-notices";

import type { Route } from "./+types/notices";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "3xl",
  pullToRefresh: true,
});

/** 목록을 못 읽어도 화면은 그대로 두고 안내만 바꾼다. */
export async function clientLoader() {
  try {
    return { notices: await listSchoolNotices() };
  } catch {
    return { notices: null };
  }
}

export default function SchoolNoticesPage({
  loaderData,
}: Route.ComponentProps) {
  return (
    <>
      <PageHeader title="학교 공지" back="/menu" />
      <SchoolNoticesScreen notices={loaderData.notices} />
    </>
  );
}
