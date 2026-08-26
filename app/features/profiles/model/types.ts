import type { Database } from "~/shared/supabase/database.types";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type ProfileType = ProfileRow["type"];
export type ProfileGender = NonNullable<ProfileRow["gender"]>;
export type ProfileAcademicTrack = NonNullable<ProfileRow["academic_track"]>;
export type ProfileMediaSlot = "avatar" | "cover";

export type AcceptedProfile = Pick<
  ProfileRow,
  | "id"
  | "pub_id"
  | "name"
  | "type"
  | "role"
  | "cohort"
  | "academic_track"
  | "avatar_path"
  | "cover_path"
  | "description"
  | "student_number"
  | "class_no"
  | "gender"
  | "phone_number"
  | "contact_email"
  | "birthday"
  | "dorm_room"
  | "department"
  | "allow_timeline_posts"
  | "is_returning_student"
> & {
  avatar_url: string | null;
  cover_url: string | null;
};

export type EditableProfile = AcceptedProfile;

type BirthdayRow =
  Database["public"]["Functions"]["list_birthdays"]["Returns"][number];

export type BirthdayScope = "today" | "month";

export type BirthdayProfile = BirthdayRow & {
  avatar_url: string | null;
};

export interface ProfileEditValues {
  name: string;
  description: string;
  birthday: string;
  phoneNumber: string;
  contactEmail: string;
  gender: ProfileGender | null;
  cohort: number | null;
  academicTrack: ProfileAcademicTrack | null;
  department: string;
  classNo: number | null;
  dormRoom: number | null;
  allowTimelinePosts: boolean;
  isReturningStudent: boolean;
}

export type ProfileEditErrors = Partial<
  Record<keyof ProfileEditValues | "form", string>
>;

export interface ProfileEditActionData {
  values?: ProfileEditValues;
  errors?: ProfileEditErrors;
}
