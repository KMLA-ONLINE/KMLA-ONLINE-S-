import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replaceAdminContacts: vi.fn(),
  accessError: new Error("access"),
}));

vi.mock("~/features/admin", () => ({
  AdminContactsScreen: () => null,
  getAdminErrorMessage: () => "요청 실패",
  isAdminAccessError: (error: unknown) => error === mocks.accessError,
  replaceAdminContacts: mocks.replaceAdminContacts,
}));

import { clientAction } from "~/routes/app/admin/contacts";

type Action = (args: { request: Request }) => Promise<unknown>;
const action = clientAction as unknown as Action;

function post(contacts: string): Request {
  const form = new FormData();
  form.set("contacts", contacts);
  return new Request("http://localhost/admin/contacts", {
    method: "POST",
    body: form,
  });
}

const valid = JSON.stringify([
  { kind: "email", label: "학생회 메일", value: "council@kmla.hs.kr" },
]);

describe("admin contacts action", () => {
  beforeEach(() => mocks.replaceAdminContacts.mockReset());

  it("saves a valid list", async () => {
    const result = await action({ request: post(valid) });
    expect(mocks.replaceAdminContacts).toHaveBeenCalledWith([
      { kind: "email", label: "학생회 메일", value: "council@kmla.hs.kr" },
    ]);
    expect(result).toMatchObject({ data: { ok: true } });
  });

  it("returns row errors without calling the RPC", async () => {
    const result = await action({
      request: post(
        JSON.stringify([{ kind: "link", label: "a", value: "http://a.kr" }]),
      ),
    });
    expect(mocks.replaceAdminContacts).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      data: { rowErrors: { 0: "링크는 https://로 시작해야 합니다." } },
      init: { status: 400 },
    });
  });

  it("redirects non-admins home", async () => {
    mocks.replaceAdminContacts.mockRejectedValueOnce(mocks.accessError);
    const thrown = await action({ request: post(valid) }).catch(
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe("/");
  });
});
