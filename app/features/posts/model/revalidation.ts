import type { ShouldRevalidateFunctionArgs } from "react-router";

/** 이미지 뷰어의 URL 상태만 바뀔 때 댓글 스레드의 로컬 상태를 유지한다. */
export function shouldRevalidatePostDetail({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (formMethod && formMethod !== "GET") return true;
  if (
    currentUrl.pathname !== nextUrl.pathname ||
    currentUrl.search === nextUrl.search
  )
    return defaultShouldRevalidate;

  const currentSearch = new URLSearchParams(currentUrl.search);
  const nextSearch = new URLSearchParams(nextUrl.search);
  currentSearch.delete("image");
  nextSearch.delete("image");

  return currentSearch.toString() === nextSearch.toString()
    ? false
    : defaultShouldRevalidate;
}
