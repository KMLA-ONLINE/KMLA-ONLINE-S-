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

export interface ShellData {
  email: string;
  profile: ShellProfile;
  /** 경로별 안 읽은 수. 사이드바와 탭바가 같은 값을 쓴다. */
  badges: Record<string, number>;
}

export interface ShellLoadData {
  email: string;
  profile: ShellProfile | null;
  badges: Record<string, number>;
}
