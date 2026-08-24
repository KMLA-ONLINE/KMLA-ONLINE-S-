import type { AuthProfile } from "~/features/auth/model/types";

export function getProfileDestination(profile: AuthProfile | null): string {
  if (!profile || profile.status === "draft") return "/setup";
  if (profile.status === "pending") return "/pending";
  if (profile.status === "blocked") return "/blocked";
  if (profile.status === "accepted") return "/";
  return "/login";
}
