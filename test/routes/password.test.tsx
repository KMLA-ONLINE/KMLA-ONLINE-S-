import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendPasswordChangeOtp: vi.fn(),
  sendPasswordResetOtp: vi.fn(),
  verifyPasswordResetOtp: vi.fn(),
  updatePassword: vi.fn(),
  loadAuthState: vi.fn(),
}));

import type * as AuthFeature from "~/features/auth";

// Components and validators stay real so the rendered markup is the shipped one;
// only the Supabase-backed calls are stubbed.
vi.mock("~/features/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthFeature>()),
  ...mocks,
}));

import { AppShellProvider, type ShellData } from "~/features/app-shell";
import MenuPasswordPage, {
  clientAction as menuPasswordAction,
} from "~/routes/app/menu/password";
import ForgotPasswordPage, {
  clientAction as forgotPasswordAction,
} from "~/routes/auth/forgot-password";
import { renderRoute, screen } from "../router";

const SHELL = {
  email: "student@kmla.hs.kr",
  profile: {
    id: 1,
    pub_id: "student",
    name: "홍길동",
    role: "member",
    type: "student",
    status: "accepted",
    avatar_url: null,
  },
  badges: {},
} satisfies ShellData;

function postRequest(entries: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return new Request("http://localhost/", { method: "POST", body: form });
}

interface ActionPayload {
  step: string;
  email?: string;
  resent?: boolean;
  errors?: Record<string, string | undefined>;
}

/** `data()` wraps the payload for the response init; tests want what is inside. */
async function payload(result: unknown): Promise<ActionPayload> {
  return (await (result as Promise<{ data: ActionPayload }>)).data;
}

describe("password change", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves to the code step after sending one", async () => {
    expect(
      await payload(
        menuPasswordAction({
          request: postRequest({ intent: "send" }),
        } as never),
      ),
    ).toEqual({ step: "verify", resent: false });
    expect(mocks.sendPasswordChangeOtp).toHaveBeenCalledOnce();
  });

  it("keeps the code step when a mismatched confirmation is submitted", async () => {
    const result = await payload(
      menuPasswordAction({
        request: postRequest({
          intent: "change",
          otp: "123456",
          password: "new-password",
          passwordConfirm: "new-passwerd",
        }),
      } as never),
    );

    expect(result.step).toBe("verify");
    expect(result.errors?.passwordConfirm).toBeDefined();
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it("sends the code as the reauthentication nonce", async () => {
    const result = await payload(
      menuPasswordAction({
        request: postRequest({
          intent: "change",
          otp: "123456",
          password: "new-password",
          passwordConfirm: "new-password",
        }),
      } as never),
    );

    expect(mocks.updatePassword).toHaveBeenCalledWith("new-password", "123456");
    expect(result).toEqual({ step: "done" });
  });

  it("renders the request step before any code is sent", () => {
    const Page = MenuPasswordPage as ComponentType<any>;

    renderRoute(
      () => (
        <AppShellProvider value={SHELL}>
          <Page />
        </AppShellProvider>
      ),
      { path: "/menu/password" },
    );

    expect(
      screen.getByRole("button", { name: "인증 코드 받기" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("새 비밀번호")).not.toBeInTheDocument();
  });
});

describe("password recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not send a code to a malformed address", async () => {
    const result = await payload(
      forgotPasswordAction({
        request: postRequest({ intent: "send", email: "nope" }),
      } as never),
    );

    expect(result.step).toBe("request");
    expect(result.errors?.email).toBeDefined();
    expect(mocks.sendPasswordResetOtp).not.toHaveBeenCalled();
  });

  it("carries the address into the code step", async () => {
    expect(
      await payload(
        forgotPasswordAction({
          request: postRequest({
            intent: "send",
            email: "student@kmla.hs.kr",
          }),
        } as never),
      ),
    ).toEqual({
      step: "verify",
      email: "student@kmla.hs.kr",
      resent: false,
    });
  });

  it("verifies the code before setting the password, then routes by status", async () => {
    mocks.loadAuthState.mockResolvedValueOnce({
      email: "student@kmla.hs.kr",
      profile: { status: "pending" },
    });

    const promise = forgotPasswordAction({
      request: postRequest({
        intent: "reset",
        email: "student@kmla.hs.kr",
        otp: "123456",
        password: "new-password",
        passwordConfirm: "new-password",
      }),
    } as never);

    await expect(promise).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Response &&
        error.headers.get("Location") === "/pending",
    );
    expect(mocks.verifyPasswordResetOtp).toHaveBeenCalledWith(
      "student@kmla.hs.kr",
      "123456",
    );
    expect(mocks.updatePassword).toHaveBeenCalledWith("new-password");
  });

  it("does not set a password when the code fails", async () => {
    mocks.verifyPasswordResetOtp.mockRejectedValueOnce(
      Object.assign(new Error("expired"), { code: "otp_expired" }),
    );

    const result = await payload(
      forgotPasswordAction({
        request: postRequest({
          intent: "reset",
          email: "student@kmla.hs.kr",
          otp: "123456",
          password: "new-password",
          passwordConfirm: "new-password",
        }),
      } as never),
    );

    expect(result.step).toBe("verify");
    expect(result.errors?.form).toMatch(/만료/);
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it("asks for the address first", () => {
    const Page = ForgotPasswordPage as ComponentType<any>;

    renderRoute(() => <Page />, { path: "/forgot-password" });

    expect(screen.getByLabelText("이메일")).toBeRequired();
    expect(screen.queryByLabelText("새 비밀번호")).not.toBeInTheDocument();
  });
});
