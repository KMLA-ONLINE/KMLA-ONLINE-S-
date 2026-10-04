import { data, Form, Link, replace, useNavigation } from "react-router";
import { useState } from "react";

import {
  AuthCard,
  getAuthErrorMessage,
  getProfileDestination,
  hasErrors,
  loadAuthState,
  PasswordField,
  readFormText,
  signIn,
  signOut,
  validateEmail,
  validatePassword,
} from "~/features/auth";
import { Button } from "~/shared/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/login";

/**
 * 로그인 화면은 통과한 뒤 history에 남지 않는다. 남겨 두면 뒤로가기가 여기로 돌아오고, 그때는
 * 이미 세션이 있으므로 이 loader가 다시 앞으로 밀어내 사용자가 갇힌다. 알림 링크처럼 로그인을
 * 거쳐 목적지로 가는 경로에서 "돌아갈 내역이 있는지"를 정확히 세려면 중간 화면이 남지 않아야
 * 한다는 점도 같다.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const state = await loadAuthState();
  if (!state) return null;

  const next = new URL(request.url).searchParams.get("next");
  const destination = getProfileDestination(state.profile, next);
  if (destination === "/login") {
    await signOut();
    return null;
  }
  throw replace(destination);
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const next = new URL(request.url).searchParams.get("next");
  const formData = await request.formData();
  const email = readFormText(formData, "email");
  const password = readFormText(formData, "password");
  const errors = {
    email: validateEmail(email),
    password: validatePassword(password),
  };

  if (hasErrors(errors)) {
    return data({ errors, email }, { status: 400 });
  }

  try {
    await signIn(email, password);
    const state = await loadAuthState();
    if (!state) throw new Error("Missing session after sign-in");

    const destination = getProfileDestination(state.profile, next);
    if (destination === "/login") {
      await signOut();
      return data(
        { errors: { form: "탈퇴한 계정은 로그인할 수 없습니다." }, email },
        { status: 403 },
      );
    }
    throw replace(destination);
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { errors: { form: getAuthErrorMessage(error) }, email },
      { status: 400 },
    );
  }
}

export default function LoginPage({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  const result = actionData as
    | {
        errors?: { form?: string; email?: string; password?: string };
        email?: string;
      }
    | undefined;
  const errors = result?.errors ?? {};
  const actionEmail = result?.email ?? "";
  const [email, setEmail] = useState(actionEmail);
  const [lastActionEmail, setLastActionEmail] = useState(actionEmail);
  if (actionEmail !== lastActionEmail) {
    setLastActionEmail(actionEmail);
    setEmail(actionEmail);
  }

  return (
    <AuthCard
      title="다시 만나서 반가워요"
      description="로그인해 소식과 이야기를 이어가세요."
      footer={
        <div className="flex flex-col items-center gap-1">
          <p>
            아직 계정이 없나요?{" "}
            <Link
              to="/signup"
              className="font-medium text-primary hover:underline"
            >
              회원가입
            </Link>
          </p>
          <p>
            비밀번호가 기억나지 않나요?{" "}
            <Link
              to="/forgot-password"
              className="font-medium text-primary hover:underline"
            >
              비밀번호 찾기
            </Link>
          </p>
        </div>
      }
    >
      <Form method="post" className="flex flex-col gap-6">
        <FieldGroup>
          {errors.form ? <FieldError>{errors.form}</FieldError> : null}
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="login-email">이메일</FieldLabel>
            <Input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(errors.email)}
              placeholder="name@example.com"
              disabled={pending}
              required
            />
            <FieldError>{errors.email}</FieldError>
          </Field>
          <PasswordField
            id="login-password"
            name="password"
            label="비밀번호"
            autoComplete="current-password"
            error={errors.password}
            disabled={pending}
          />
        </FieldGroup>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          로그인
        </Button>
      </Form>
    </AuthCard>
  );
}
