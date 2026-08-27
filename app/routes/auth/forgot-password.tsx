import { data, Form, Link, redirect, useNavigation } from "react-router";

import {
  AuthCard,
  getAuthErrorMessage,
  getProfileDestination,
  hasErrors,
  loadAuthState,
  OtpField,
  PasswordField,
  readFormText,
  sendPasswordResetOtp,
  updatePassword,
  validateEmail,
  validateOtpCode,
  validatePassword,
  validatePasswordConfirm,
  verifyPasswordResetOtp,
} from "~/features/auth";
import { Button } from "~/shared/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/forgot-password";

/**
 * 단계는 `actionData`만으로 정해지고, 이메일은 응답에 실려 돌아와 hidden 필드로 다시
 * 제출된다. 코드 확인과 새 비밀번호 설정을 한 번의 제출로 끝내므로, 검증만 통과하고
 * 비밀번호 설정이 실패해 세션만 남는 어중간한 상태가 화면에 생기지 않는다.
 */
interface ForgotPasswordActionData {
  step: "request" | "verify";
  email: string;
  resent?: boolean;
  errors?: {
    form?: string;
    email?: string;
    otp?: string;
    password?: string;
    passwordConfirm?: string;
  };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = readFormText(formData, "intent");
  const email = readFormText(formData, "email");

  if (intent === "send" || intent === "resend") {
    const emailError = validateEmail(email);
    if (emailError) {
      return data(
        { step: "request" as const, email, errors: { email: emailError } },
        { status: 400 },
      );
    }

    const resent = intent === "resend";
    try {
      await sendPasswordResetOtp(email);
      return data({ step: "verify" as const, email, resent });
    } catch (error) {
      return data(
        {
          step: resent ? ("verify" as const) : ("request" as const),
          email,
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
    return data({ step: "verify" as const, email, errors }, { status: 400 });
  }

  try {
    await verifyPasswordResetOtp(email, otp);
    await updatePassword(password);

    const state = await loadAuthState();
    if (!state) throw new Error("Missing session after password reset");
    throw redirect(getProfileDestination(state.profile));
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      {
        step: "verify" as const,
        email,
        errors: { form: getAuthErrorMessage(error) },
      },
      { status: 400 },
    );
  }
}

export default function ForgotPasswordPage({
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  const result = actionData as ForgotPasswordActionData | undefined;
  const step = result?.step ?? "request";
  const errors = result?.errors ?? {};

  return (
    <AuthCard
      title="비밀번호를 잊으셨나요"
      description={
        step === "verify"
          ? `${result?.email}로 보낸 숫자 6자리를 입력하고 새 비밀번호를 설정하세요.`
          : "가입한 이메일로 인증 코드를 보내 드릴게요."
      }
      footer={
        <p>
          비밀번호가 기억났나요?{" "}
          <Link
            to="/login"
            className="font-medium text-primary hover:underline"
          >
            로그인
          </Link>
        </p>
      }
    >
      <Form method="post" className="flex flex-col gap-6">
        <FieldGroup>
          {errors.form ? <FieldError>{errors.form}</FieldError> : null}
          {result?.resent ? (
            <p role="status" className="text-sm text-primary">
              인증 코드를 다시 보냈습니다.
            </p>
          ) : null}

          {step === "request" ? (
            <Field data-invalid={Boolean(errors.email)}>
              <FieldLabel htmlFor="forgot-email">이메일</FieldLabel>
              <Input
                id="forgot-email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={result?.email}
                aria-invalid={Boolean(errors.email)}
                placeholder="name@example.com"
                disabled={pending}
                required
              />
              <FieldError>{errors.email}</FieldError>
              <FieldDescription>
                가입한 계정이 있으면 인증 코드가 도착합니다.
              </FieldDescription>
            </Field>
          ) : (
            <>
              <input type="hidden" name="email" value={result?.email} />
              <OtpField id="forgot-otp" error={errors.otp} disabled={pending} />
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
              <PasswordField
                id="forgot-password"
                name="password"
                label="새 비밀번호"
                autoComplete="new-password"
                error={errors.password}
                disabled={pending}
              />
              <PasswordField
                id="forgot-password-confirm"
                name="passwordConfirm"
                label="새 비밀번호 확인"
                autoComplete="new-password"
                error={errors.passwordConfirm}
                disabled={pending}
              />
              <FieldDescription>
                비밀번호는 8자 이상이어야 합니다. 재설정하면 다른 기기의
                로그인이 해제됩니다.
              </FieldDescription>
            </>
          )}
        </FieldGroup>

        <Button
          type="submit"
          name="intent"
          value={step === "request" ? "send" : "reset"}
          size="lg"
          disabled={pending}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {step === "request" ? "인증 코드 받기" : "비밀번호 재설정"}
        </Button>
      </Form>
    </AuthCard>
  );
}
