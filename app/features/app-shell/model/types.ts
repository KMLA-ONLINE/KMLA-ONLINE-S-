import type { Database } from "~/shared/supabase/database.types";

type MyProfileRow =
  Database["public"]["Functions"]["get_my_profile"]["Returns"][number];

export type ProfileStatus = Database["public"]["Enums"]["profile_status"];
export type ProfileRole = Database["public"]["Enums"]["app_role"];

/** 셸이 헤더·사이드바·게이트에 쓰는 최소 프로필. 라우트가 더 필요하면 자기 로더에서 읽는다. */
export interface ShellProfile {
  id: MyProfileRow["id"];
  pub_id: MyProfileRow["pub_id"];
  name: MyProfileRow["name"];
  role: MyProfileRow["role"];
  type: MyProfileRow["type"];
  status: MyProfileRow["status"];
  avatar_url: string | null;
}

/**
 * 셸 뱃지는 여기 없다. 안 읽은 수는 `notificationBadgeQuery()`가 소유하고 `useNavBadges()`가
 * 읽는다 — 뱃지 하나 때문에 게이트와 현재 라우트 로더를 통째로 재검증하지 않기 위해서다.
 */
export interface ShellData {
  email: string;
  profile: ShellProfile;
}

export interface ShellLoadData {
  email: string;
  profile: ShellProfile | null;
}
