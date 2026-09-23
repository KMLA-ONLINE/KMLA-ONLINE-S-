import type { AuthProfile } from "~/features/auth/model/types";

export function sanitizeLoginNext(value: string | null): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;

  try {
    const url = new URL(value, "https://kmla.online");
    if (url.origin !== "https://kmla.online") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function getProfileDestination(
  profile: AuthProfile | null,
  next?: string | null,
): string {
  if (!profile || profile.status === "draft") return "/setup";
  if (profile.status === "pending") return "/pending";
  if (profile.status === "blocked") return "/blocked";
  if (profile.status === "accepted")
    return sanitizeLoginNext(next ?? null) ?? "/";
  return "/login";
}
