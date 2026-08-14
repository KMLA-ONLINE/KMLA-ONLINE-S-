import type {
  PostFormErrors,
  PostFormValues,
  PostIdentity,
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
