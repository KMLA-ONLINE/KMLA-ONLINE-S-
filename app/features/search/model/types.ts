import type { Database } from "~/shared/supabase/database.types";

export type SearchDirectoryRow =
  Database["public"]["Functions"]["search_directory"]["Returns"][number];

export interface DirectoryPersonResult {
  kind: "profile";
  id: string; // pub_id
  name: string;
  avatarPath: string | null;
  avatarUrl: string | null;
}

export interface DirectoryGroupResult {
  kind: "group";
  id: string; // slug
  name: string;
  avatarPath: string | null; // group icon_path, resolved the same way as a profile avatar
  avatarUrl: string | null;
}

export type DirectoryResult = DirectoryPersonResult | DirectoryGroupResult;

export interface DirectorySearchResult {
  people: DirectoryPersonResult[];
  groups: DirectoryGroupResult[];
}
