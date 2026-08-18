import type {
  PostFormErrors,
  PostFormValues,
  PostIdentity,
  PostVisibility,
  ProfilePostFormErrors,
  ProfilePostFormValues,
} from "~/features/posts/model/types";
import { normalizePostMarkdownSource } from "~/features/posts/model/markdown";

const IDENTITIES: PostIdentity[] = ["identified", "anonymous", "staff"];

export function readPostForm(formData: FormData): PostFormValues {
  const identity = formData.get("authorIdentity");
  const title = formData.get("title");
  const body = formData.get("body");
  const categoryId = formData.get("categoryId");
  return {
    title: typeof title === "string" ? title.trim() : "",
    body: typeof body === "string" ? normalizePostMarkdownSource(body) : "",
    categoryId: typeof categoryId === "string" ? categoryId : "",
    authorIdentity: IDENTITIES.includes(identity as PostIdentity)
      ? (identity as PostIdentity)
      : "identified",
  };
}

export function validatePostForm(
  values: PostFormValues,
  attachmentCount = 0,
  allowedIdentities?: PostIdentity[],
  categoryIds?: string[],
): PostFormErrors {
  const errors: PostFormErrors = {};
  if (!values.title) errors.title = "제목을 입력해 주세요.";
  else if (Array.from(values.title).length > 100)
    errors.title = "제목은 100자 이하로 입력해 주세요.";
  if (!values.body && attachmentCount === 0)
    errors.body = "본문 또는 첨부 파일을 추가해 주세요.";
  else if (Array.from(values.body).length > 20_000)
    errors.body = "본문은 20,000자 이하로 입력해 주세요.";
  if (allowedIdentities && !allowedIdentities.includes(values.authorIdentity))
    errors.authorIdentity = "선택할 수 없는 작성 신원입니다.";
  if (
    values.categoryId &&
    categoryIds &&
    !categoryIds.includes(values.categoryId)
  )
    errors.categoryId = "선택할 수 없는 카테고리입니다.";
  return errors;
}

const VISIBILITIES: PostVisibility[] = ["public", "private"];

export function readProfilePostForm(formData: FormData): ProfilePostFormValues {
  const body = formData.get("body");
  const visibility = formData.get("visibility");
  return {
    body: typeof body === "string" ? normalizePostMarkdownSource(body) : "",
    visibility: VISIBILITIES.includes(visibility as PostVisibility)
      ? (visibility as PostVisibility)
      : "public",
  };
}

/**
 * 개인 게시물 폼 검사 (기능 명세 §8.3, §8.4).
 *
 * 제목이 없으므로 본문 또는 첨부가 유일한 필수 항목이다. 공개 범위 선택은 자기 타임라인에서만
 * 열리므로, 타인 타임라인이면 `private`이 들어온 것 자체가 잘못된 폼이다 — 서버도 같은 이유로
 * 전체 공개로 되돌린다.
 */
export function validateProfilePostForm(
  values: ProfilePostFormValues,
  attachmentCount = 0,
  canChooseVisibility = true,
): ProfilePostFormErrors {
  const errors: ProfilePostFormErrors = {};
  if (!values.body && attachmentCount === 0)
    errors.body = "본문 또는 첨부 파일을 추가해 주세요.";
  else if (Array.from(values.body).length > 20_000)
    errors.body = "본문은 20,000자 이하로 입력해 주세요.";
  if (!canChooseVisibility && values.visibility !== "public")
    errors.visibility =
      "다른 사용자의 타임라인에 쓴 게시물은 전체 공개로만 남길 수 있습니다.";
  return errors;
}

export function hasProfilePostFormErrors(
  errors: ProfilePostFormErrors,
): boolean {
  return Object.keys(errors).length > 0;
}

export function validateSelectedFiles(
  files: File[],
  currentCount: number,
): string | null {
  if (currentCount + files.length > 10)
    return "첨부 파일은 최대 10개까지 추가할 수 있습니다.";
  for (const file of files) {
    if (file.size === 0) return `빈 파일은 첨부할 수 없습니다: ${file.name}`;
    if (file.size > 30 * 1024 * 1024)
      return `파일은 30MiB 이하여야 합니다: ${file.name}`;
  }
  return null;
}

export function hasPostFormErrors(errors: PostFormErrors): boolean {
  return Object.keys(errors).length > 0;
}
