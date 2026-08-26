import { createProfileMediaUrls } from "~/features/profiles/data/media";
import type {
  AcceptedProfile,
  BirthdayProfile,
  BirthdayScope,
} from "~/features/profiles/model/types";
import { getSupabase } from "~/shared/supabase/client";

type ProfileRow = Omit<AcceptedProfile, "avatar_url" | "cover_url">;

async function hydrateProfile(row: ProfileRow): Promise<AcceptedProfile> {
  const mediaUrls = await createProfileMediaUrls([
    row.avatar_path,
    row.cover_path,
  ]);

  return {
    ...row,
    avatar_url: row.avatar_path
      ? (mediaUrls.get(row.avatar_path) ?? null)
      : null,
    cover_url: row.cover_path ? (mediaUrls.get(row.cover_path) ?? null) : null,
  };
}

export async function loadAcceptedProfile(
  pubId: string,
): Promise<AcceptedProfile | null> {
  const { data, error } = await getSupabase().rpc("get_accepted_profile", {
    p_pub_id: pubId,
  });

  if (error) throw error;
  const profile = data?.[0];
  if (!profile) return null;

  return hydrateProfile(profile);
}

export async function loadMyEditableProfile(): Promise<AcceptedProfile | null> {
  const { data, error } = await getSupabase().rpc("get_my_profile");
  if (error) throw error;

  const profile = data?.[0];
  if (profile?.status !== "accepted") return null;

  return hydrateProfile(profile);
}

export async function loadProfileDepartments(): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("profile_departments")
    .select("name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((department) => department.name);
}

export async function listBirthdays(
  referenceDate: string,
  scope: BirthdayScope,
): Promise<BirthdayProfile[]> {
  const { data, error } = await getSupabase().rpc("list_birthdays", {
    p_reference_date: referenceDate,
    p_scope: scope,
  });
  if (error) throw error;

  const birthdays = data ?? [];
  const avatarUrls = await createProfileMediaUrls(
    birthdays.map((birthday) => birthday.avatar_path),
  );

  return birthdays.map((birthday) => ({
    ...birthday,
    avatar_url: avatarUrls.get(birthday.avatar_path) ?? null,
  }));
}
