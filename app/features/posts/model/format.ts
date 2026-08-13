export function getPostErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object")
    return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "42501") return "이 작업을 수행할 권한이 없습니다.";
  if (candidate.code === "23505")
    return "같은 이름의 카테고리가 이미 있습니다.";
  if (candidate.code === "23503")
    return "선택한 그룹 또는 카테고리를 찾을 수 없습니다.";
  if (candidate.code === "23514" || candidate.code === "22023")
    return "입력 내용을 다시 확인해 주세요.";
  if (candidate.code === "P0002") return "게시물을 찾을 수 없습니다.";
  if (candidate.message?.includes("category"))
    return "카테고리 정보를 다시 확인해 주세요.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function formatPostDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
