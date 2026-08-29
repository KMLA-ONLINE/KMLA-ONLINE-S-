import { createGroupMediaUrls } from "~/features/groups/data/files";
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import type { RecentSearchEntry } from "~/features/search/model/recent-searches";
import type {
  DirectoryGroupResult,
  DirectoryPersonResult,
  DirectorySearchResult,
} from "~/features/search/model/types";
import { getSupabase } from "~/shared/supabase/client";

export async function searchDirectory(
  query: string,
): Promise<DirectorySearchResult> {
  const { data, error } = await getSupabase().rpc("search_directory", {
    p_query: query,
  });
  if (error) throw error;

  const rows = data ?? [];
  const peopleRows = rows.filter((row) => row.result_kind === "profile");
  const groupRows = rows.filter((row) => row.result_kind === "group");

  const [avatarUrls, iconUrls] = await Promise.all([
    createProfileMediaUrls(peopleRows.map((row) => row.avatar_path)),
    createGroupMediaUrls(groupRows.map((row) => row.avatar_path)),
  ]);

  const people: DirectoryPersonResult[] = peopleRows.map((row) => ({
    kind: "profile",
    id: row.result_id,
    name: row.result_name,
    avatarPath: row.avatar_path,
    avatarUrl: row.avatar_path
      ? (avatarUrls.get(row.avatar_path) ?? null)
      : null,
  }));

  const groups: DirectoryGroupResult[] = groupRows.map((row) => ({
    kind: "group",
    id: row.result_id,
    name: row.result_name,
    avatarPath: row.avatar_path,
    avatarUrl: row.avatar_path ? (iconUrls.get(row.avatar_path) ?? null) : null,
  }));

  return { people, groups };
}

export async function resolveRecentSearchEntryUrls(
  entries: RecentSearchEntry[],
): Promise<Map<string, string>> {
  const profilePaths = entries
    .filter((entry) => entry.kind === "profile")
    .map((entry) => entry.avatarPath);
  const groupPaths = entries
    .filter((entry) => entry.kind === "group")
    .map((entry) => entry.avatarPath);

  const [profileUrls, groupUrls] = await Promise.all([
    createProfileMediaUrls(profilePaths),
    createGroupMediaUrls(groupPaths),
  ]);

  const combined = new Map<string, string>();
  for (const [path, url] of profileUrls) combined.set(`profile:${path}`, url);
  for (const [path, url] of groupUrls) combined.set(`group:${path}`, url);
  return combined;
}
