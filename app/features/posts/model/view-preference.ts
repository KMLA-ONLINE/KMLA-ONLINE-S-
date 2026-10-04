import type { PostViewMode } from "~/features/posts/model/types";

const STORAGE_KEY = "kmla-online:posts-view:v1";

export function readPostViewMode(): PostViewMode {
  if (typeof window === "undefined") return "card";
  return window.localStorage.getItem(STORAGE_KEY) === "list" ? "list" : "card";
}

export function writePostViewMode(mode: PostViewMode): void {
  if (typeof window !== "undefined")
    window.localStorage.setItem(STORAGE_KEY, mode);
}
