import { CheckIcon } from "lucide-react";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  useSubmit,
} from "react-router";

import {
  AuthCard,
  clearSignupDraft,
  getAuthErrorMessage,
  getProfileDestination,
  getSignupDraft,
  hasActiveSession,
  hasErrors,
  loadAuthState,
  OtpField,
  PasswordField,
  ProfileFields,
  readFormText,
  readProfileForm,
  resendSignupOtp,
  saveSignupDraft,
  signOut,
  signUp,
  submitProfile,
  validateEmail,
  validateOtpCode,
  validatePassword,
  validatePasswordConfirm,
  validateProfileForm,
  verifySignupOtp,
  type FieldErrors,
  type ProfileFormValues,
  type SignupDraft,
} from "~/features/auth";
import { cn } from "~/shared/lib/utils";
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
import type { Route } from "./+types/signup";

/**
 * 가입은 계정 → 프로필 → 이메일 인증 세 단계다.
 *
 * 계정 생성(`signUp`)이 곧 코드 발송이라, 그 호출을 마지막 단계 바로 앞까지 미룬다. 첫
 * 화면에서 계정을 만들어 두면 사용자가 프로필을 다 쓰고 코드를 입력할 때쯤 코드가 이미
 * 늙어 있고, 그게 "한 번에 인증이 안 되는" 원인이었다. 대신 이메일과 비밀번호는 인증
 * 단계로 넘어갈 때까지 폼 안에 들고 있는다 — 어디에도 저장하지 않는다.
 *
 * 인증 단계에 들어선 뒤부터는 계정이 이미 있으므로 비밀번호가 더 필요 없다. 그 시점의
 * 입력값만 `sessionStorage` 초안으로 남겨서, 모바일에서 메일 앱을 다녀오다 페이지가 다시
 * 로드돼도 코드 입력 화면으로 돌아오게 한다.
 */
const STEPS = [
  { id: "credentials", label: "계정" },
  { id: "profile", label: "프로필" },
  { id: "verify", label: "이메일 인증" },
] as const;

type SignupStep = (typeof STEPS)[number]["id"];

interface SignupState {
  step: SignupStep;
  email: string;
  password: string;
  values: ProfileFormValues;
  resent?: boolean;
  verified?: boolean;
  errors?: FieldErrors;
}

const EMPTY_VALUES: ProfileFormValues = {
  name: "",
  type: "student",
  studentNumber: "",
  classNo: "",
  cohort: "",
  gender: "",
  academicTrack: "",
  phoneNumber: "",
  birthday: "",
  dormRoom: "",
};

const RESTART: SignupState = {
  step: "credentials",
  email: "",
  password: "",
  values: EMPTY_VALUES,
};

export async function clientLoader() {
  const state = await loadAuthState();

  if (state) {
    const destination = getProfileDestination(state.profile);
    if (destination !== "/login") throw redirect(destination);
    await signOut();
  }

  return { draft: getSignupDraft() };
}

/**
 * 인증 단계의 제출은 폼이 아니라 초안에서 값을 읽는다.
 *
 * 계정이 만들어진 뒤라 화면에 남아 있어야 할 것은 코드 입력란뿐이고, 프로필 값을 hidden
 * 필드로 다시 실어 보내면 새로고침 한 번에 같이 사라진다.
 */
async function submitVerifyStep(intent: string, otp: string) {
  const draft = getSignupDraft();
  if (!draft) {
    return data(
      {
        ...RESTART,
        errors: {
          form: "가입 정보가 남아 있지 않아요. 처음부터 다시 입력해 주세요.",
        },
      },
      { status: 400 },
    );
  }

  const base = {
    step: "verify" as const,
    email: draft.email,
    password: "",
    values: draft.values,
  };

  if (intent === "resend") {
    try {
      await resendSignupOtp(draft.email);
      return data({ ...base, resent: true });
    } catch (error) {
      return data(
        { ...base, errors: { form: getAuthErrorMessage(error) } },
        { status: 400 },
      );
    }
  }

  // 코드 확인은 성공했는데 프로필 제출이 실패한 상태가 있을 수 있다. 그때 코드를 다시
  // 요구하면 이미 소모된 코드라 영영 통과하지 못하므로, 세션이 있으면 확인을 건너뛴다.
  const verified = await hasActiveSession();

  if (!verified) {
    const otpError = validateOtpCode(otp);
    if (otpError) {
      return data({ ...base, errors: { otp: otpError } }, { status: 400 });
    }
  }

  try {
    if (!verified) await verifySignupOtp(draft.email, otp);
    await submitProfile(draft.values);
    throw redirect("/pending");
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      {
        ...base,
        verified: await hasActiveSession(),
        errors: { form: getAuthErrorMessage(error) },
      },
      { status: 400 },
    );
  }
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = readFormText(formData, "intent");

  if (intent === "restart") {
    clearSignupDraft();
    return data(RESTART);
  }

  if (intent === "resend" || intent === "verify") {
    return submitVerifyStep(intent, readFormText(formData, "otp"));
  }

  const email = readFormText(formData, "email");
  const password = readFormText(formData, "password");
  const values = readProfileForm(formData);

  if (intent === "back") {
    return data({ step: "credentials" as const, email, password, values });
  }

  if (intent === "profile") {
    const errors = validateProfileForm(values);
    if (hasErrors(errors)) {
      return data(
        { step: "profile" as const, email, password, values, errors },
        { status: 400 },
      );
    }

    try {
      await signUp(email, password);
    } catch (error) {
      return data(
        {
          step: "profile" as const,
          email,
          password,
          values,
          errors: { form: getAuthErrorMessage(error) },
        },
        { status: 400 },
      );
    }

    saveSignupDraft({ email, values });
    return data({ step: "verify" as const, email, password: "", values });
  }

  const errors: FieldErrors = {
    email: validateEmail(email),
    password: validatePassword(password),
    passwordConfirm: validatePasswordConfirm(
      password,
      readFormText(formData, "passwordConfirm"),
    ),
  };

  if (hasErrors(errors)) {
    return data(
      { step: "credentials" as const, email, password, values, errors },
      { status: 400 },
    );
  }

  return data({ step: "profile" as const, email, password, values });
}

function initialState(draft: SignupDraft | null): SignupState {
  if (!draft) return RESTART;

  return {
    step: "verify",
    email: draft.email,
    password: "",
    values: draft.values,
  };
}

function StepIndicator({ current }: { current: SignupStep }) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);

  return (
    <ol aria-label="가입 단계" className="mb-8 flex items-center gap-2">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;

        return (
          <li
            key={step.id}
            aria-current={active ? "step" : undefined}
            className="flex flex-1 items-center gap-2 last:flex-none"
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                active && "bg-primary text-primary-foreground",
                done && "bg-primary/15 text-primary",
                !active && !done && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-xs whitespace-nowrap",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "h-px flex-1",
                  done ? "bg-primary/40" : "bg-border",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const PROFILE_FIELDS = Object.keys(EMPTY_VALUES) as (keyof ProfileFormValues)[];

/** 계정 단계에서 프로필 입력값을 잃지 않게 그대로 실어 나른다. */
function HiddenProfileValues({ values }: { values: ProfileFormValues }) {
  return (
    <>
      {PROFILE_FIELDS.map((name) => (
        <input key={name} type="hidden" name={name} value={values[name]} />
      ))}
    </>
  );
}

const TITLES: Record<SignupStep, string> = {
  credentials: "KMLA Online 시작하기",
  profile: "학교 구성원 정보",
  verify: "이메일 인증",
};

export default function SignupPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const pending = navigation.state === "submitting";
  const result: SignupState = actionData ?? initialState(loaderData.draft);

  /**
   * 보조 동작은 submit 버튼이 아니라 button + 프로그램 제출로 보낸다.
   *
   * Enter와 모바일 키보드의 '이동'은 폼의 기본 버튼 — tree order상 첫 submit 버튼 — 을
   * 누른다. 재발송이나 이전이 그 자리에 있으면 코드를 다 입력하고 이동을 눌렀을 때 제출
   * 대신 그쪽이 실행된다. 보이는 순서를 건드리지 않고 기본 버튼만 제자리로 돌려놓는다.
   */
  function submitIntent(
    event: React.MouseEvent<HTMLButtonElement>,
    intent: string,
  ) {
    const form = event.currentTarget.form;
    if (!form) return;

    const formData = new FormData(form);
    formData.set("intent", intent);
    void submit(formData, { method: "post" });
  }
  const { step, email, password, values } = result;
  const errors = result.errors ?? {};

  const description =
    step === "credentials"
      ? "계정을 만든 뒤 정보를 확인받으면 바로 시작할 수 있어요."
      : step === "profile"
        ? "확인에 필요한 정보입니다. 승인 전에는 기능이 제한됩니다."
        : `${email}로 보낸 숫자 6자리를 입력해 주세요.`;

  return (
    <AuthCard
      title={TITLES[step]}
      description={description}
      wide={step === "profile"}
      footer={
        step === "credentials" ? (
          <p>
            이미 계정이 있나요?{" "}
            <Link
              to="/login"
              className="font-medium text-primary hover:underline"
            >
              로그인
            </Link>
          </p>
        ) : undefined
      }
    >
      <StepIndicator current={step} />

      <Form method="post" className="flex flex-col gap-6">
        {errors.form ? <FieldError>{errors.form}</FieldError> : null}

        {step === "credentials" ? (
          <>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="signup-email">이메일</FieldLabel>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue={email}
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
                defaultValue={password}
                error={errors.password}
                disabled={pending}
              />
              <PasswordField
                id="signup-password-confirm"
                name="passwordConfirm"
                label="비밀번호 확인"
                autoComplete="new-password"
                defaultValue={password}
                error={errors.passwordConfirm}
                disabled={pending}
              />
            </FieldGroup>
            <HiddenProfileValues values={values} />
            <Button
              type="submit"
              name="intent"
              value="credentials"
              size="lg"
              disabled={pending}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              다음
            </Button>
          </>
        ) : null}

        {step === "profile" ? (
          <>
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="password" value={password} />
            <ProfileFields values={values} errors={errors} disabled={pending} />
            <FieldDescription>
              다음 단계로 넘어가는 순간 {email}로 인증 코드를 보내 드려요.
            </FieldDescription>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={(event) => submitIntent(event, "back")}
                disabled={pending}
              >
                이전
              </Button>
              <Button
                type="submit"
                name="intent"
                value="profile"
                size="lg"
                className="flex-1"
                disabled={pending}
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}
                인증 코드 받기
              </Button>
            </div>
          </>
        ) : null}

        {step === "verify" ? (
          <>
            {result.resent ? (
              <p role="status" className="text-sm text-primary">
                인증 코드를 다시 보냈습니다.
              </p>
            ) : null}

            {result.verified ? (
              <p role="status" className="text-sm text-primary">
                이메일 인증은 끝났어요. 제출만 다시 눌러 주세요.
              </p>
            ) : (
              <FieldGroup>
                <OtpField
                  id="signup-otp"
                  error={errors.otp}
                  disabled={pending}
                />
                <Button
                  type="button"
                  variant="link"
                  className="w-fit px-0"
                  onClick={(event) => submitIntent(event, "resend")}
                  disabled={pending}
                >
                  인증 코드 다시 보내기
                </Button>
              </FieldGroup>
            )}

            <Button
              type="submit"
              name="intent"
              value="verify"
              size="lg"
              disabled={pending}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              가입 신청 제출
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-fit self-center px-0 text-muted-foreground"
              onClick={(event) => submitIntent(event, "restart")}
              disabled={pending}
            >
              다른 이메일로 다시 시작하기
            </Button>
          </>
        ) : null}
      </Form>
    </AuthCard>
  );
}
