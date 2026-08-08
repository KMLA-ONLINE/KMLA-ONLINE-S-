import type { AuthProfile } from "~/features/auth/model/types";

export function getProfileDestination(profile: AuthProfile | null): string {
  if (!profile || profile.status === "rejected") return "/setup";
  if (profile.status === "pending") return "/pending";
  if (profile.status === "accepted") return "/";
  return "/login";
}
