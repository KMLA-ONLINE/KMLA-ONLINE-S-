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

const KIB = 1024;
const MIB = KIB * KIB;

/** 첨부 행에 붙는 크기 표기. 1KiB 미만은 정수 바이트, 1MiB 미만은 정수 KB, 그 위는 소수 첫째 자리. */
export function formatFileSize(bytes: number): string {
  if (bytes < KIB) return `${bytes}B`;
  if (bytes < MIB) return `${Math.round(bytes / KIB)} KB`;
  return `${(bytes / MIB).toFixed(1)} MB`;
}

/**
 * 댓글 전용 오류 문구.
 *
 * 코드 집합은 게시물과 같지만 사용자가 읽는 대상이 다르고, 댓글 RPC는 깊이와 신원처럼 게시물에
 * 없는 이유로도 거절한다. 문구를 게시물과 한 함수에 몰면 어느 쪽에도 맞지 않는 말이 된다.
 */
export function getCommentErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object")
    return "댓글을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

  const candidate = error as { code?: string; message?: string };
  const message = candidate.message ?? "";

  if (message.includes("nest deeper"))
    return "답글은 10단계까지만 달 수 있습니다.";
  if (message.includes("1 and 5000 characters"))
    return "댓글은 1자 이상 5,000자 이하로 입력해 주세요.";
  if (message.includes("staff identity"))
    return "운영진 명의는 그룹 운영진만 사용할 수 있습니다.";
  if (message.includes("anonymous commenting"))
    return "이 그룹에서는 익명으로 댓글을 쓸 수 없습니다.";
  if (message.includes("identified commenting"))
    return "이 그룹에서는 실명으로 댓글을 쓸 수 없습니다.";
  if (message.includes("only the author"))
    return "이 댓글을 수정하거나 삭제할 권한이 없습니다.";
  if (message.includes("parent comment"))
    return "답글을 달 댓글을 찾을 수 없습니다.";

  if (candidate.code === "42501") return "이 작업을 수행할 권한이 없습니다.";
  if (candidate.code === "P0002") return "댓글을 찾을 수 없습니다.";
  if (candidate.code === "23514" || candidate.code === "22023")
    return "댓글 내용을 다시 확인해 주세요.";
  return "댓글을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
