import { CheckIcon } from "lucide-react";
import { useState } from "react";
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
  claimSignupPassword,
  clearSignupDraft,
  DUPLICATE_STUDENT_NUMBER_MESSAGE,
  getAuthErrorMessage,
  getProfileDestination,
  getSignupDraft,
  hasActiveSession,
  hasErrors,
  isDuplicateStudentNumberError,
  isInvalidEmailAddressError,
  loadAuthState,
  OtpField,
  LegalLinks,
  PasswordField,
  PrivacyNotice,
  ProfileFields,
  readFormText,
  readProfileForm,
  readTermsAgreement,
  resendSignupOtp,
  saveSignupDraft,
  signOut,
  signUp,
  submitProfile,
  TERMS_VERSION,
  TermsAgreementField,
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
import {
  DeferredAdminContactList,
  listAdminContacts,
} from "~/features/support";
import { getCurrentLocale, translate, useT } from "~/shared/i18n";
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
import { Separator } from "~/shared/ui/separator";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/signup";

/**
 * 가입은 계정 → 약관 → 프로필 → 이메일 인증 네 단계다.
 *
 * 약관 단계는 학교 프로필을 받기 전에 이용약관 동의와 개인정보 처리 안내를 끝낸다. 동의 여부는
 * 다른 값처럼 폼에 실어 나르고, 인증 단계로 넘어갈 때 동의한 판을 초안에 남긴다.
 *
 * 계정 생성(`signUp`)이 곧 코드 발송이라, 그 호출을 마지막 단계 바로 앞까지 미룬다. 첫
 * 화면에서 계정을 만들어 두면 사용자가 프로필을 다 쓰고 코드를 입력할 때쯤 코드가 이미
 * 늙어 있고, 그게 "한 번에 인증이 안 되는" 원인이었다. 대신 이메일과 비밀번호는 인증
 * 단계로 넘어갈 때까지 폼 안에 들고 있는다 — 어디에도 저장하지 않는다.
 *
 * 인증 단계에서도 비밀번호는 폼 안에만 들고 있다가 코드 확인 직후 계정에 다시 저장한다
 * (`claimSignupPassword`). 인증 전 계정에 다시 가입하면 Auth가 처음 비밀번호를 그대로 두기
 * 때문인데, 그 계정을 남이 만들어 뒀을 수도 있으니 이 저장은 건너뛸 수 없다.
 *
 * 이메일과 프로필 값만 `sessionStorage` 초안으로 남겨서, 모바일에서 메일 앱을 다녀오다
 * 페이지가 다시 로드돼도 코드 입력 화면으로 돌아오게 한다. 그렇게 돌아오면 비밀번호가 없으므로
 * 인증 단계에서 다시 입력받는다(`askPassword`).
 */
const STEPS = [
  { id: "credentials", label: "계정" },
  { id: "terms", label: "약관" },
  { id: "profile", label: "프로필" },
  { id: "verify", label: "이메일 인증" },
] as const;

type SignupStep = (typeof STEPS)[number]["id"];

interface SignupState {
  step: SignupStep;
  email: string;
  password: string;
  values: ProfileFormValues;
  /** 약관 단계에서 이용약관에 동의했는지. 인증 단계는 초안의 동의 기록을 쓴다. */
  termsAgreed?: boolean;
  /** 인증 단계에서 비밀번호를 입력란으로 받을지. 아니면 앞 단계 값을 hidden으로 넘긴다. */
  askPassword?: boolean;
  resent?: boolean;
  verified?: boolean;
  /** 인증은 끝났지만 학번이 이미 쓰인다. 다시 제출해도 같으므로 학번을 고칠 `/setup`으로 안내한다. */
  studentNumberTaken?: boolean;
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

  // 인증 메일이 오지 않아 가입이 막힌 사람을 위해 인증 단계에서만 보인다.
  return {
    draft: getSignupDraft(),
    contacts: listAdminContacts().catch(() => []),
  };
}

/**
 * 인증 단계의 제출은 비밀번호를 뺀 값을 폼이 아니라 초안에서 읽는다.
 *
 * 프로필 값을 hidden 필드로 다시 실어 보내면 새로고침 한 번에 같이 사라진다. 비밀번호는
 * 초안에 넣지 않으므로 늘 폼에서 읽는다.
 */
async function submitVerifyStep(intent: string, formData: FormData) {
  const locale = getCurrentLocale();
  const otp = readFormText(formData, "otp");
  const password = readFormText(formData, "password");
  // 확인란이 있었다는 건 이 화면에서 비밀번호를 직접 받았다는 뜻이다.
  const askPassword = formData.has("passwordConfirm");
  const draft = getSignupDraft();
  if (!draft) {
    return data(
      {
        ...RESTART,
        errors: {
          form: translate(
            locale,
            "가입 정보가 남아 있지 않아요. 처음부터 다시 입력해 주세요.",
          ),
        },
      },
      { status: 400 },
    );
  }

  const base = {
    step: "verify" as const,
    email: draft.email,
    password,
    values: draft.values,
    askPassword,
  };

  if (intent === "resend") {
    try {
      await resendSignupOtp(draft.email);
      return data({ ...base, resent: true });
    } catch (error) {
      return data(
        { ...base, errors: { form: getAuthErrorMessage(error, locale) } },
        { status: 400 },
      );
    }
  }

  // 코드 확인은 성공했는데 프로필 제출이 실패한 상태가 있을 수 있다. 그때 코드를 다시
  // 요구하면 이미 소모된 코드라 영영 통과하지 못하므로, 세션이 있으면 확인을 건너뛴다.
  const verified = await hasActiveSession();

  // 코드는 한 번 쓰면 사라지므로, 비밀번호 문제로 막힐 제출이면 코드를 쓰기 전에 돌려보낸다.
  const errors: FieldErrors = {
    otp: verified ? undefined : validateOtpCode(otp, locale),
    password: validatePassword(password, locale),
    passwordConfirm: askPassword
      ? validatePasswordConfirm(
          password,
          readFormText(formData, "passwordConfirm"),
          locale,
        )
      : undefined,
  };
  if (hasErrors(errors)) {
    // hidden으로 넘어온 비밀번호가 틀렸다면 고칠 입력란이 있어야 한다.
    const ask = askPassword || Boolean(errors.password);
    return data(
      { ...base, askPassword: ask, verified, errors },
      { status: 400 },
    );
  }

  // 초안을 남긴 뒤 앱이 새 약관 판으로 업데이트됐다. 옛 판은 서버가 매번 거절하므로 코드를 쓰기 전에
  // 약관 단계로 돌려 다시 동의받는다. 인증을 마친 뒤의 새로고침은 로더가 `/setup`으로 보내 거기서 받는다.
  if (!verified && draft.termsVersion !== TERMS_VERSION) {
    return data(
      {
        step: "terms" as const,
        email: draft.email,
        password,
        values: draft.values,
        errors: {
          terms: translate(
            locale,
            "이용약관이 바뀌었어요. 다시 확인하고 동의해 주세요.",
          ),
        },
      },
      { status: 400 },
    );
  }

  let claiming = false;
  try {
    if (!verified) await verifySignupOtp(draft.email, otp);
    claiming = true;
    await claimSignupPassword(password);
    claiming = false;
    await submitProfile(draft.values, draft.termsVersion);
    throw redirect("/pending");
  } catch (error) {
    if (error instanceof Response) throw error;
    const studentNumberTaken = isDuplicateStudentNumberError(error);
    return data(
      {
        ...base,
        // 서버가 거절한 비밀번호를 hidden으로 계속 보내면 빠져나올 수 없다.
        askPassword: askPassword || claiming,
        verified: await hasActiveSession(),
        studentNumberTaken,
        errors: {
          form: studentNumberTaken
            ? translate(locale, DUPLICATE_STUDENT_NUMBER_MESSAGE)
            : getAuthErrorMessage(error, locale),
        },
      },
      { status: 400 },
    );
  }
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const locale = getCurrentLocale();
  const intent = readFormText(formData, "intent");

  if (intent === "restart") {
    clearSignupDraft();
    return data(RESTART);
  }

  if (intent === "resend" || intent === "verify") {
    return submitVerifyStep(intent, formData);
  }

  const email = readFormText(formData, "email");
  const password = readFormText(formData, "password");
  const values = readProfileForm(formData);
  const termsAgreed = readTermsAgreement(formData);
  const fields = { email, password, values, termsAgreed };

  if (intent === "back") {
    const from = readFormText(formData, "step");
    return data({
      step: from === "profile" ? ("terms" as const) : ("credentials" as const),
      ...fields,
    });
  }

  // 프로필 제출도 동의를 다시 본다. 약관 단계를 건너뛴 제출로 계정이 만들어지면 안 된다.
  if ((intent === "terms" || intent === "profile") && !termsAgreed) {
    return data(
      {
        step: "terms" as const,
        ...fields,
        errors: {
          terms: translate(locale, "이용약관에 동의해야 가입할 수 있어요."),
        },
      },
      { status: 400 },
    );
  }

  if (intent === "terms") {
    return data({ step: "profile" as const, ...fields });
  }

  if (intent === "profile") {
    const errors = validateProfileForm(values, locale);
    if (hasErrors(errors)) {
      return data(
        { step: "profile" as const, ...fields, errors },
        { status: 400 },
      );
    }

    try {
      await signUp(email, password);
    } catch (error) {
      // 이메일 칸은 첫 단계에만 있다. 여기 머물면 고칠 곳이 없으므로 그 단계로 돌려보낸다.
      if (isInvalidEmailAddressError(error)) {
        return data(
          {
            step: "credentials" as const,
            ...fields,
            errors: { email: getAuthErrorMessage(error, locale) },
          },
          { status: 400 },
        );
      }
      return data(
        {
          step: "profile" as const,
          ...fields,
          errors: { form: getAuthErrorMessage(error, locale) },
        },
        { status: 400 },
      );
    }

    saveSignupDraft({ email, values, termsVersion: TERMS_VERSION });
    return data({ step: "verify" as const, ...fields });
  }

  const errors: FieldErrors = {
    email: validateEmail(email, locale),
    password: validatePassword(password, locale),
    passwordConfirm: validatePasswordConfirm(
      password,
      readFormText(formData, "passwordConfirm"),
      locale,
    ),
  };

  if (hasErrors(errors)) {
    return data(
      { step: "credentials" as const, ...fields, errors },
      { status: 400 },
    );
  }

  return data({ step: "terms" as const, ...fields });
}

function initialState(draft: SignupDraft | null): SignupState {
  if (!draft) return RESTART;

  return {
    step: "verify",
    email: draft.email,
    password: "",
    values: draft.values,
    termsAgreed: true,
    askPassword: true,
  };
}

function StepIndicator({ current }: { current: SignupStep }) {
  const t = useT();
  const currentIndex = STEPS.findIndex((step) => step.id === current);

  return (
    <ol aria-label={t("가입 단계")} className="mb-8 flex items-center gap-2">
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
                active && "bg-action text-action-foreground",
                done && "bg-primary/15 text-primary",
                !active && !done && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-3.5" /> : index + 1}
            </span>
            {/* 네 단계 라벨이 320px 폭에 다 들어가지 않아, 아주 좁은 화면에서는 현재 단계만 보인다. */}
            <span
              className={cn(
                "text-xs whitespace-nowrap",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground max-[359px]:sr-only",
              )}
            >
              {t(step.label)}
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
  terms: "약관 및 개인정보 안내",
  profile: "학교 구성원 정보",
  verify: "이메일 인증",
};

export default function SignupPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const t = useT();
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
  // 이메일 오류는 그 제출의 결과라, 사용자가 고치기 시작하면 내린다. 다음 제출의 결과는
  // 새 객체이므로 같은 오류가 다시 나면 다시 보인다.
  const [emailEditedFor, setEmailEditedFor] = useState<unknown>(null);
  const emailError = emailEditedFor === actionData ? undefined : errors.email;

  const description =
    step === "credentials"
      ? t("계정을 만든 뒤 정보를 확인받으면 바로 시작할 수 있어요.")
      : step === "terms"
        ? t("학교 프로필을 입력하기 전에 확인해 주세요.")
        : step === "profile"
          ? t("확인에 필요한 정보입니다. 승인 전에는 기능이 제한됩니다.")
          : t("{email}로 보낸 숫자 6자리를 입력해 주세요.", { email });
  // 결과가 바뀌면(다른 단계에서 돌아오면) 그 결과의 동의 여부로 다시 시작한다.
  const [termsCheckedFor, setTermsCheckedFor] = useState<{
    result: unknown;
    checked: boolean;
  } | null>(null);
  const termsChecked =
    termsCheckedFor && termsCheckedFor.result === actionData
      ? termsCheckedFor.checked
      : Boolean(result.termsAgreed);

  return (
    <AuthCard
      title={t(TITLES[step])}
      description={description}
      wide={step === "profile" || step === "terms"}
      footer={
        step === "credentials" ? (
          <div className="flex flex-col gap-3">
            <p>
              {t("이미 계정이 있나요?")}{" "}
              <Link
                to="/login"
                className="font-medium text-primary hover:underline"
              >
                {t("로그인")}
              </Link>
            </p>
            <LegalLinks />
          </div>
        ) : step === "terms" || step === "profile" ? (
          <LegalLinks />
        ) : step === "verify" ? (
          <DeferredAdminContactList
            contacts={loaderData.contacts}
            prompt={t("인증 메일이 오지 않나요?")}
          />
        ) : undefined
      }
    >
      <StepIndicator current={step} />

      <Form method="post" className="flex flex-col gap-6">
        {errors.form ? <FieldError>{errors.form}</FieldError> : null}
        {/* 약관 단계 밖에서는 동의 여부를 hidden으로 실어 날라, 앞뒤로 오가도 다시 묻지 않는다. */}
        {step !== "terms" && result.termsAgreed ? (
          <input type="hidden" name="terms" value={TERMS_VERSION} />
        ) : null}

        {step === "credentials" ? (
          <>
            <FieldGroup>
              <Field data-invalid={Boolean(emailError)}>
                <FieldLabel htmlFor="signup-email">{t("이메일")}</FieldLabel>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue={email}
                  onChange={() => setEmailEditedFor(actionData)}
                  aria-invalid={Boolean(emailError)}
                  placeholder="name@example.com"
                  disabled={pending}
                  required
                />
                <FieldError>{emailError}</FieldError>
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
              {t("다음")}
            </Button>
          </>
        ) : null}

        {step === "terms" ? (
          <>
            <input type="hidden" name="step" value="terms" />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="password" value={password} />
            <HiddenProfileValues values={values} />
            <section
              aria-labelledby="terms-title"
              className="flex flex-col gap-3"
            >
              <h2 id="terms-title" className="text-base font-semibold">
                {t("이용약관")}
              </h2>
              <TermsAgreementField
                id="signup-terms"
                checked={termsChecked}
                onCheckedChange={(checked) =>
                  setTermsCheckedFor({ result: actionData, checked })
                }
                error={termsChecked ? undefined : errors.terms}
                disabled={pending}
              />
            </section>
            <Separator />
            <PrivacyNotice />
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={(event) => submitIntent(event, "back")}
                disabled={pending}
              >
                {t("이전")}
              </Button>
              <Button
                type="submit"
                name="intent"
                value="terms"
                size="lg"
                className="flex-1"
                disabled={!termsChecked || pending}
              >
                {t("다음")}
              </Button>
            </div>
          </>
        ) : null}

        {step === "profile" ? (
          <>
            <input type="hidden" name="step" value="profile" />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="password" value={password} />
            <ProfileFields values={values} errors={errors} disabled={pending} />
            <FieldDescription>
              {t(
                "다음 단계로 넘어가는 순간 {email}로 인증 코드를 보내 드려요.",
                {
                  email,
                },
              )}
            </FieldDescription>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={(event) => submitIntent(event, "back")}
                disabled={pending}
              >
                {t("이전")}
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
                {t("인증 코드 받기")}
              </Button>
            </div>
          </>
        ) : null}

        {step === "verify" ? (
          <>
            {result.askPassword ? null : (
              <input type="hidden" name="password" value={password} />
            )}
            {result.resent ? (
              <p role="status" className="text-sm text-primary">
                {t("인증 코드를 다시 보냈습니다.")}
              </p>
            ) : null}

            {result.studentNumberTaken ? null : result.verified ? (
              <p role="status" className="text-sm text-primary">
                {t("이메일 인증은 끝났어요. 제출만 다시 눌러 주세요.")}
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
                  {t("인증 코드 다시 보내기")}
                </Button>
              </FieldGroup>
            )}

            {result.askPassword ? (
              <FieldGroup>
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
                <FieldDescription>
                  {t(
                    "로그인에 쓸 비밀번호를 한 번 더 입력해 주세요. 인증을 마치면 이 비밀번호로 정해져요.",
                  )}
                </FieldDescription>
              </FieldGroup>
            ) : null}

            {result.studentNumberTaken ? (
              // 세션은 이미 있고 초안도 남아 있어, /setup이 입력값을 그대로 채워 연다.
              <Button size="lg" render={<Link to="/setup" />}>
                {t("학번 수정하기")}
              </Button>
            ) : (
              <Button
                type="submit"
                name="intent"
                value="verify"
                size="lg"
                disabled={pending}
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {t("가입 신청 제출")}
              </Button>
            )}
            <Button
              type="button"
              variant="link"
              className="w-fit self-center px-0 text-muted-foreground"
              onClick={(event) => submitIntent(event, "restart")}
              disabled={pending}
            >
              {t("다른 이메일로 다시 시작하기")}
            </Button>
          </>
        ) : null}
      </Form>
    </AuthCard>
  );
}
