import { createProfileMediaUrls } from "~/features/profiles/data/media";
import type { AcceptedProfile } from "~/features/profiles/model/types";
import { getSupabase } from "~/shared/supabase/client";
import type { Database } from "~/shared/supabase/database.types";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

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
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("*")
    .eq("pub_id", pubId.toLowerCase())
    .eq("status", "accepted")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return hydrateProfile(data);
}

export async function loadMyEditableProfile(): Promise<AcceptedProfile | null> {
  const { data, error } = await getSupabase().rpc("get_my_profile");
  if (error) throw error;

  const profile = data?.[0];
  if (profile?.status !== "accepted") return null;

  return hydrateProfile(profile);
}
