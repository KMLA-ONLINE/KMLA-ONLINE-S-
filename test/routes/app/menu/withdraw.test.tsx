import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withdrawAccount: vi.fn(),
  listMyOwnedGroups: vi.fn(),
}));

import type * as AuthFeature from "~/features/auth";

vi.mock("~/features/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthFeature>()),
  ...mocks,
}));

import { clientAction } from "~/routes/app/menu/withdraw";

function postRequest(entries: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return new Request("http://localhost/settings/withdraw", {
    method: "POST",
    body: form,
  });
}

interface ActionPayload {
  errors: Record<string, string | undefined>;
}

async function payload(result: unknown): Promise<ActionPayload> {
  return (await (result as Promise<{ data: ActionPayload }>)).data;
}

describe("account withdrawal action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires the acknowledgement and the password before calling the server", async () => {
    const result = await payload(
      clientAction({ request: postRequest({}) } as never),
    );

    expect(result.errors).toEqual({
      confirm: "안내를 확인했다고 체크해 주세요.",
      password: "비밀번호를 입력해 주세요.",
    });
    expect(mocks.withdrawAccount).not.toHaveBeenCalled();
  });

  it("shows a wrong password on the password field", async () => {
    mocks.withdrawAccount.mockRejectedValueOnce({
      code: "invalid_credentials",
    });

    const result = await payload(
      clientAction({
        request: postRequest({ confirm: "on", password: "wrong-pass" }),
      } as never),
    );

    expect(mocks.withdrawAccount).toHaveBeenCalledWith("wrong-pass");
    expect(result.errors).toEqual({
      password: "비밀번호가 올바르지 않습니다.",
    });
  });

  it("shows a server-side refusal on the form", async () => {
    mocks.withdrawAccount.mockRejectedValueOnce({
      code: "55000",
      message: "group ownership must be transferred before withdrawal",
      hint: "group_owner",
    });

    const result = await payload(
      clientAction({
        request: postRequest({ confirm: "on", password: "correct-pass" }),
      } as never),
    );

    expect(result.errors).toEqual({
      form: "소유한 그룹이 있어 탈퇴할 수 없습니다. 먼저 소유권을 넘겨 주세요.",
    });
  });

  it("sends the withdrawn person to the login screen with a completion notice", async () => {
    mocks.withdrawAccount.mockResolvedValueOnce(undefined);

    const response = await clientAction({
      request: postRequest({ confirm: "on", password: "correct-pass" }),
    } as never).catch((thrown: unknown) => thrown);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe(
      "/login?withdrawn=1",
    );
  });
});
