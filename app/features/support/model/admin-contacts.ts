/**
 * 앱을 쓰지 못하는 사람(로그인 전, 승인 대기, 차단)이 관리자에게 닿는 연락처. 앱 관리자가 화면에서
 * 고치고 로그인 전 화면에 공개된다. 아래 검사는 UX용이고 같은 규칙을 DB 제약이 강제한다.
 */
export interface AdminContact {
  kind: "link" | "email";
  label: string;
  value: string;
}

export const ADMIN_CONTACT_LIMIT = 10;
const LABEL_MAX = 40;
const LINK_PATTERN = /^https:\/\/\S+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParseAdminContactsResult =
  | { ok: true; contacts: AdminContact[] }
  | { ok: false; form: string }
  | { ok: false; errors: Record<number, string> };

export function adminContactHref(contact: AdminContact): string {
  return contact.kind === "email" ? `mailto:${contact.value}` : contact.value;
}

export function parseAdminContacts(json: string): ParseAdminContactsResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, form: "잘못된 요청입니다." };
  }
  if (!Array.isArray(raw) || !raw.every(isContactShape))
    return { ok: false, form: "잘못된 요청입니다." };
  if (raw.length > ADMIN_CONTACT_LIMIT)
    return {
      ok: false,
      form: `연락처는 ${ADMIN_CONTACT_LIMIT}개까지 둘 수 있습니다.`,
    };

  const contacts = raw.map((contact) => ({
    kind: contact.kind,
    label: contact.label.trim(),
    value: contact.value.trim(),
  }));
  const errors: Record<number, string> = {};
  contacts.forEach((contact, index) => {
    const error = contactError(contact);
    if (error) errors[index] = error;
  });
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, contacts };
}

function contactError(contact: AdminContact): string | null {
  if (!contact.label) return "이름을 입력해 주세요.";
  // DB의 `char_length`처럼 UTF-16 단위가 아니라 문자 단위로 센다.
  if ([...contact.label].length > LABEL_MAX)
    return `이름은 ${LABEL_MAX}자 이내로 입력해 주세요.`;
  if (contact.kind === "link")
    return LINK_PATTERN.test(contact.value) && contact.value.length <= 500
      ? null
      : "링크는 https://로 시작해야 합니다.";
  return EMAIL_PATTERN.test(contact.value) && contact.value.length <= 254
    ? null
    : "이메일 형식이 올바르지 않습니다.";
}

function isContactShape(value: unknown): value is AdminContact {
  if (typeof value !== "object" || value === null) return false;
  const contact = value as Record<string, unknown>;
  return (
    (contact.kind === "link" || contact.kind === "email") &&
    typeof contact.label === "string" &&
    typeof contact.value === "string"
  );
}
