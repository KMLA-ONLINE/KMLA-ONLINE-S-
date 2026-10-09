import type {
  ShouldRevalidateFunction,
  ShouldRevalidateFunctionArgs,
} from "react-router";

/**
 * loader가 읽지 않는 UI 전용 URL 상태(이미지 뷰어 `image`, 댓글 시트 `view`, 반응 목록 `reactions`). 안드로이드 뒤로가기로 닫히도록 URL에 산다.
 * 목록 화면의 오버레이 파라미터가 하나라도 빠지면 여닫기만으로 loader가 다시 돌아 쌓은 페이지가 버려진다.
 */
const POST_UI_SEARCH_PARAMS = ["image", "view", "reactions"] as const;

/** `ignoredKeys`를 뺀 나머지 검색 파라미터가 두 URL에서 같은가. 키 순서는 보지 않는다. */
function isUiOnlySearchChange(
  currentUrl: URL,
  nextUrl: URL,
  ignoredKeys: Iterable<string>,
): boolean {
  const ignored = new Set(ignoredKeys);
  const keys = new Set([
    ...currentUrl.searchParams.keys(),
    ...nextUrl.searchParams.keys(),
  ]);

  return Array.from(keys).every(
    (key) =>
      ignored.has(key) ||
      currentUrl.searchParams.getAll(key).join("\0") ===
        nextUrl.searchParams.getAll(key).join("\0"),
  );
}

/** 상세 안의 UI URL 상태만 바뀔 때 댓글 스레드의 로컬 상태를 유지한다. */
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

  return isUiOnlySearchChange(currentUrl, nextUrl, POST_UI_SEARCH_PARAMS)
    ? false
    : defaultShouldRevalidate;
}

/**
 * 게시물 목록 화면의 `shouldRevalidate`를 만든다. `extraUiParams`는 그 화면 고유의 오버레이 파라미터다.
 * 컴포넌트는 loader 객체가 바뀌면 더 불러온 페이지를 버리므로 불필요한 재검증은 정확성 문제다.
 */
export function createPostListRevalidation(
  extraUiParams: readonly string[] = [],
): ShouldRevalidateFunction {
  const uiParams = [...POST_UI_SEARCH_PARAMS, ...extraUiParams];

  return ({ currentUrl, nextUrl, formMethod }) => {
    if (formMethod && formMethod !== "GET") return true;
    // 명시적 revalidate(`useRevalidator`)는 URL이 그대로다 — 당겨서 새로고침이 이 경로다.
    if (currentUrl.href === nextUrl.href) return true;
    if (currentUrl.pathname !== nextUrl.pathname) return true;

    return !isUiOnlySearchChange(currentUrl, nextUrl, uiParams);
  };
}
