import type { Database } from "~/shared/supabase/database.types";

type MyProfileRow =
  Database["public"]["Functions"]["get_my_profile"]["Returns"][number];

export type ProfileRole = Database["public"]["Enums"]["app_role"];

/** 게이트가 읽는 최소 프로필. 라우트가 더 필요하면 자기 로더에서 읽는다. */
export interface ShellProfileRow {
  id: MyProfileRow["id"];
  pub_id: MyProfileRow["pub_id"];
  name: MyProfileRow["name"];
  role: MyProfileRow["role"];
  type: MyProfileRow["type"];
  status: MyProfileRow["status"];
  avatar_path: MyProfileRow["avatar_path"];
}

/**
 * 화면이 `useAppShell()`로 읽는 프로필. `avatar_url`은 게이트를 막지 않도록 셸이 나중에 채우며,
 * 서명되기 전과 사진이 없을 때는 `null`이다.
 */
export interface ShellProfile extends ShellProfileRow {
  avatar_url: string | null;
}

/**
 * 셸 뱃지는 여기 없다. 안 읽은 수는 `notificationBadgeQuery()`가 소유하고 `useNavBadges()`가
 * 읽는다 — 뱃지 하나 때문에 게이트와 현재 라우트 로더를 통째로 재검증하지 않기 위해서다.
 */
export interface ShellData {
  email: string;
  profile: ShellProfileRow;
}

/** `ShellData`에 아바타 URL을 채운 값. `useAppShell()`이 돌려준다. */
export interface AppShellValue {
  email: string;
  profile: ShellProfile;
}

export interface ShellLoadData {
  email: string;
  profile: ShellProfileRow | null;
}
