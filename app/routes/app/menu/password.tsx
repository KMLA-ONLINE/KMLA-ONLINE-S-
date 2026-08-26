import { CheckIcon, MailIcon } from "lucide-react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { data, Form, Link, useNavigation } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import {
  getAuthErrorMessage,
  hasErrors,
  PasswordField,
  readFormText,
  sendPasswordChangeOtp,
  updatePassword,
  validateOtpCode,
  validatePassword,
  validatePasswordConfirm,
} from "~/features/auth";
import { Button } from "~/shared/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/shared/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "~/shared/ui/input-otp";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/password";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

/**
 * 화면이 어느 단계에 서 있는지는 오직 `actionData`가 정한다.
 *
 * 코드를 보냈다는 사실을 컴포넌트 state로 들고 있으면 실패 응답이 돌아올 때마다 단계가
 * 어긋난다. 대신 모든 응답이 자기 단계를 같이 실어 보내므로, 첫 렌더(응답 없음)만
 * `request`이고 나머지는 서버 응답이 그대로 화면이 된다.
 */
interface PasswordActionData {
  step: "request" | "verify" | "done";
  resent?: boolean;
  errors?: {
    form?: string;
    otp?: string;
    password?: string;
    passwordConfirm?: string;
  };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = readFormText(formData, "intent");

  if (intent === "send" || intent === "resend") {
    const resent = intent === "resend";
    try {
      await sendPasswordChangeOtp();
      return data({ step: "verify" as const, resent });
    } catch (error) {
      return data(
        {
          step: resent ? ("verify" as const) : ("request" as const),
          errors: { form: getAuthErrorMessage(error) },
        },
        { status: 400 },
      );
    }
  }

  const otp = readFormText(formData, "otp");
  const password = readFormText(formData, "password");
  const errors = {
    otp: validateOtpCode(otp),
    password: validatePassword(password),
    passwordConfirm: validatePasswordConfirm(
      password,
      readFormText(formData, "passwordConfirm"),
    ),
  };

  if (hasErrors(errors)) {
    return data({ step: "verify" as const, errors }, { status: 400 });
  }

  try {
    await updatePassword(password, otp);
    return data({ step: "done" as const });
  } catch (error) {
    return data(
      {
        step: "verify" as const,
        errors: { form: getAuthErrorMessage(error) },
      },
      { status: 400 },
    );
  }
}

export default function MenuPasswordPage({ actionData }: Route.ComponentProps) {
  const { email } = useAppShell();
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  const result = actionData as PasswordActionData | undefined;
  const step = result?.step ?? "request";
  const errors = result?.errors ?? {};

  return (
    <>
      <PageHeader title="비밀번호 변경" back="/menu" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">
          비밀번호 변경
        </h1>

        {step === "done" ? (
          <section className="flex flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckIcon className="size-6" />
            </div>
            <div>
              <p className="font-medium">비밀번호를 변경했습니다</p>
              <p className="mt-1 text-sm text-muted-foreground">
                다른 기기에서는 새 비밀번호로 다시 로그인해 주세요.
              </p>
            </div>
            <Button render={<Link to="/menu" />} variant="outline">
              메뉴로 돌아가기
            </Button>
          </section>
        ) : (
          <Form method="post" className="flex flex-col gap-6">
            <section className="flex flex-col gap-4 rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <MailIcon
                  className="mt-0.5 size-4.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">이메일 본인 확인</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {step === "verify"
                      ? `${email}로 보낸 숫자 6자리를 입력해 주세요.`
                      : `${email}로 인증 코드를 보내 본인을 확인합니다.`}
                  </p>
                </div>
              </div>

              {errors.form ? <FieldError>{errors.form}</FieldError> : null}
              {result?.resent ? (
                <p role="status" className="text-sm text-primary">
                  인증 코드를 다시 보냈습니다.
                </p>
              ) : null}

              {step === "request" ? (
                <Button
                  type="submit"
                  name="intent"
                  value="send"
                  className="w-full sm:w-fit"
                  disabled={pending}
                >
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  인증 코드 받기
                </Button>
              ) : (
                <FieldGroup>
                  <Field data-invalid={Boolean(errors.otp)}>
                    <FieldLabel htmlFor="password-otp">인증 코드</FieldLabel>
                    <InputOTP
                      id="password-otp"
                      name="otp"
                      maxLength={6}
                      pattern={REGEXP_ONLY_DIGITS}
                      disabled={pending}
                      aria-invalid={Boolean(errors.otp)}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot
                          index={0}
                          aria-invalid={Boolean(errors.otp)}
                        />
                        <InputOTPSlot
                          index={1}
                          aria-invalid={Boolean(errors.otp)}
                        />
                        <InputOTPSlot
                          index={2}
                          aria-invalid={Boolean(errors.otp)}
                        />
                      </InputOTPGroup>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        <InputOTPSlot
                          index={3}
                          aria-invalid={Boolean(errors.otp)}
                        />
                        <InputOTPSlot
                          index={4}
                          aria-invalid={Boolean(errors.otp)}
                        />
                        <InputOTPSlot
                          index={5}
                          aria-invalid={Boolean(errors.otp)}
                        />
                      </InputOTPGroup>
                    </InputOTP>
                    <FieldError>{errors.otp}</FieldError>
                  </Field>
                  <Button
                    type="submit"
                    name="intent"
                    value="resend"
                    variant="link"
                    className="w-fit px-0"
                    formNoValidate
                    disabled={pending}
                  >
                    인증 코드 다시 보내기
                  </Button>
                </FieldGroup>
              )}
            </section>

            {step === "verify" ? (
              <>
                <section className="rounded-xl border bg-card p-4">
                  <FieldGroup>
                    <PasswordField
                      id="new-password"
                      name="password"
                      label="새 비밀번호"
                      autoComplete="new-password"
                      error={errors.password}
                      disabled={pending}
                    />
                    <PasswordField
                      id="new-password-confirm"
                      name="passwordConfirm"
                      label="새 비밀번호 확인"
                      autoComplete="new-password"
                      error={errors.passwordConfirm}
                      disabled={pending}
                    />
                    <FieldDescription>
                      비밀번호는 8자 이상이어야 합니다. 변경하면 다른 기기의
                      로그인이 해제됩니다.
                    </FieldDescription>
                  </FieldGroup>
                </section>

                <Button
                  type="submit"
                  name="intent"
                  value="change"
                  size="lg"
                  disabled={pending}
                >
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  비밀번호 변경
                </Button>
              </>
            ) : null}
          </Form>
        )}
      </div>
    </>
  );
}
