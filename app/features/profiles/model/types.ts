import type { Database } from "~/shared/supabase/database.types";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type AcceptedProfile = Pick<
  ProfileRow,
  | "pub_id"
  | "name"
  | "type"
  | "role"
  | "cohort"
  | "academic_track"
  | "avatar_path"
  | "description"
>;
