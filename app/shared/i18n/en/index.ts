import { auth } from "~/shared/i18n/en/auth";
import { admin } from "~/shared/i18n/en/admin";
import { donations } from "~/shared/i18n/en/donations";
import { groups } from "~/shared/i18n/en/groups";
import { profiles } from "~/shared/i18n/en/profiles";
import { school } from "~/shared/i18n/en/school";
import { search } from "~/shared/i18n/en/search";
import { stories } from "~/shared/i18n/en/stories";
import { support } from "~/shared/i18n/en/support";
import { common } from "~/shared/i18n/en/common";
import { messaging } from "~/shared/i18n/en/messaging";
import { notifications } from "~/shared/i18n/en/notifications";
import { posts } from "~/shared/i18n/en/posts";
import { posts_sub } from "~/shared/i18n/en/posts-sub";
import { settings } from "~/shared/i18n/en/settings";
import { shell } from "~/shared/i18n/en/shell";

/**
 * 한국어 원문 → 영어. 화면 영역별 파일로 나눠 두고 여기서 합친다. 같은 원문이 두 파일에
 * 있으면 번역도 같아야 한다(`test/shared/i18n/translate.test.ts`가 확인한다).
 */
export const en: Readonly<Record<string, string>> = {
  ...common,
  ...shell,
  ...auth,
  ...settings,
  ...notifications,
  ...posts,
  ...posts_sub,
  ...messaging,
  ...groups,
  ...profiles,
  ...stories,
  ...school,
  ...donations,
  ...search,
  ...support,
  ...admin,
};
