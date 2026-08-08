/**
 * 셸이 쓰는 타입.
 *
 * **지금은 손으로 선언돼 있다.** `app/shared/supabase/database.types.ts`의 `public` 스키마가
 * 아직 비어 있어서(`Tables`/`Functions` 모두 `[_ in never]: never`) 파생시킬 원본이 없다.
 * `profiles` 테이블과 `get_my_profile()`이 마이그레이션으로 들어오면 아래처럼 바꾼다:
 *
 * ```ts
 * type MyProfileRow =
 *   Database["public"]["Functions"]["get_my_profile"]["Returns"][number];
 * export type ProfileStatus = Database["public"]["Enums"]["profile_status"];
 * export type ShellProfile = Pick<MyProfileRow, "id" | "name" | "role" | "status"> & {
 *   avatar_url: MyProfileRow["avatar_url"] | null;
 * };
 * ```
 *
 * 그때까지 이 파일이 스키마의 단일 가정치다. 여기와 실제 스키마가 어긋나면 컴파일이 아니라
 * 런타임에서 터지므로, 마이그레이션을 쓰는 순간 이 파일부터 지운다.
 */

export type ProfileStatus =
  "none" | "pending" | "accepted" | "rejected" | "withdrawn";

export type ProfileRole = "student" | "teacher" | "alumni" | "admin";

/** 셸이 헤더·사이드바·게이트에 쓰는 최소 프로필. 라우트가 더 필요하면 자기 로더에서 읽는다. */
export interface ShellProfile {
  id: string;
  name: string;
  role: ProfileRole;
  status: ProfileStatus;
  avatar_url: string | null;
}

export interface ShellData {
  email: string;
  profile: ShellProfile;
  /** 경로별 안 읽은 수. 사이드바와 탭바가 같은 값을 쓴다. */
  badges: Record<string, number>;
}
