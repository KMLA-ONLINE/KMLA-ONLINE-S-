import { describe, expect, it } from "vitest";

import {
  adminContactHref,
  parseAdminContacts,
  type AdminContact,
} from "~/features/support/model/admin-contacts";

const link: AdminContact = {
  kind: "link",
  label: "오픈채팅",
  value: "https://open.kakao.com/o/abc",
};
const email: AdminContact = {
  kind: "email",
  label: "학생회 메일",
  value: "council@kmla.hs.kr",
};

describe("adminContactHref", () => {
  it("opens links as-is and emails with mailto", () => {
    expect(adminContactHref(link)).toBe("https://open.kakao.com/o/abc");
    expect(adminContactHref(email)).toBe("mailto:council@kmla.hs.kr");
  });
});

describe("parseAdminContacts", () => {
  it("accepts valid contacts and trims text", () => {
    const result = parseAdminContacts(
      JSON.stringify([
        { ...link, label: " 오픈채팅 " },
        { ...email, value: " council@kmla.hs.kr " },
      ]),
    );
    expect(result).toEqual({ ok: true, contacts: [link, email] });
  });

  it("accepts an empty list so admins can remove every contact", () => {
    expect(parseAdminContacts("[]")).toEqual({ ok: true, contacts: [] });
  });

  it("rejects links that are not https", () => {
    const result = parseAdminContacts(
      JSON.stringify([{ ...link, value: "http://example.com" }]),
    );
    expect(result).toEqual({
      ok: false,
      errors: { 0: "링크는 https://로 시작해야 합니다." },
    });
  });

  it("rejects malformed emails and empty labels per row", () => {
    const result = parseAdminContacts(
      JSON.stringify([link, { ...email, label: "  ", value: "nope" }]),
    );
    expect(result).toEqual({
      ok: false,
      errors: { 1: "이름을 입력해 주세요." },
    });
    expect(
      parseAdminContacts(JSON.stringify([{ ...email, value: "nope" }])),
    ).toEqual({ ok: false, errors: { 0: "이메일 형식이 올바르지 않습니다." } });
  });

  it("counts label length in characters like the DB", () => {
    expect(
      parseAdminContacts(JSON.stringify([{ ...link, label: "😀".repeat(40) }])),
    ).toEqual({ ok: true, contacts: [{ ...link, label: "😀".repeat(40) }] });
  });

  it("rejects labels over 40 characters", () => {
    expect(
      parseAdminContacts(JSON.stringify([{ ...link, label: "가".repeat(41) }])),
    ).toEqual({
      ok: false,
      errors: { 0: "이름은 40자 이내로 입력해 주세요." },
    });
  });

  it("rejects more than ten contacts and malformed payloads", () => {
    expect(
      parseAdminContacts(
        JSON.stringify(Array.from({ length: 11 }, () => link)),
      ),
    ).toEqual({ ok: false, form: "연락처는 10개까지 둘 수 있습니다." });
    expect(parseAdminContacts("not json")).toEqual({
      ok: false,
      form: "잘못된 요청입니다.",
    });
    expect(
      parseAdminContacts(
        JSON.stringify([{ kind: "phone", label: "a", value: "1" }]),
      ),
    ).toEqual({ ok: false, form: "잘못된 요청입니다." });
  });
});
