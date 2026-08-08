import { data, Form, Link, redirect, useNavigation } from "react-router";

import {
  AuthCard,
  getAuthErrorMessage,
  getProfileDestination,
  hasErrors,
  loadAuthState,
  PasswordField,
  readFormText,
  signOut,
  signUp,
  validateEmail,
  validatePassword,
} from "~/features/auth";
import { Button } from "~/shared/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/signup";

export async function clientLoader() {
  const state = await loadAuthState();
  if (!state) return null;

  const destination = getProfileDestination(state.profile);
  if (destination === "/login") {
    await signOut();
    return null;
  }
  throw redirect(destination);
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const email = readFormText(formData, "email");
  const password = readFormText(formData, "password");
  const passwordConfirm = readFormText(formData, "passwordConfirm");
  const errors = {
    email: validateEmail(email),
    password: validatePassword(password),
    passwordConfirm:
      password !== passwordConfirm
        ? "비밀번호가 일치하지 않습니다."
        : undefined,
  };

  if (hasErrors(errors)) {
    return data({ errors, email }, { status: 400 });
  }

  try {
    await signUp(email, password);
    throw redirect("/setup");
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { errors: { form: getAuthErrorMessage(error) }, email },
      { status: 400 },
    );
  }
}

export default function SignupPage({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  const result = actionData as
    | {
        errors?: {
          form?: string;
          email?: string;
          password?: string;
          passwordConfirm?: string;
        };
        email?: string;
      }
    | undefined;
  const errors = result?.errors ?? {};

  return (
    <AuthCard
      title="KMLA Online 시작하기"
      description="계정을 만든 뒤 학교 구성원 정보를 확인받으면 바로 시작할 수 있어요."
      footer={
        <p>
          이미 계정이 있나요?{" "}
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
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="signup-email">이메일</FieldLabel>
            <Input
              id="signup-email"
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
          </Field>
          <PasswordField
            id="signup-password"
            name="password"
            label="비밀번호"
            autoComplete="new-password"
            error={errors.password}
            disabled={pending}
          />
          <PasswordField
            id="signup-password-confirm"
            name="passwordConfirm"
            label="비밀번호 확인"
            autoComplete="new-password"
            error={errors.passwordConfirm}
            disabled={pending}
          />
        </FieldGroup>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          계정 만들기
        </Button>
      </Form>
    </AuthCard>
  );
}
