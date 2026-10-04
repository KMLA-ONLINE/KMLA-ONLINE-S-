import { data, Form, redirect, useNavigation } from "react-router";

import {
  AuthCard,
  getAuthErrorMessage,
  getProfileDestination,
  getSignupDraft,
  hasErrors,
  loadAuthState,
  ProfileFields,
  readProfileForm,
  signOut,
  submitProfile,
  validateProfileForm,
  type AuthState,
  type FieldErrors,
  type ProfileFormValues,
} from "~/features/auth";
import { Button } from "~/shared/ui/button";
import { FieldError } from "~/shared/ui/field";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/setup";

/**
 * 로그인 상태에서만 열리는 프로필 화면이다. 이메일 인증은 `/signup`의 마지막 단계가
 * 책임지므로 여기에는 인증 코드 입력란이 없다.
 *
 * 여기로 오는 길은 둘이다. 차단이 풀려 `미작성`으로 돌아온 사용자의 재제출, 그리고 가입
 * 마법사에서 코드 확인까지는 통과했지만 프로필 제출만 실패해 세션만 남은 경우다.
 */
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

function initialValues(state: AuthState): ProfileFormValues {
  const profile = state.profile;

  if (!profile) {
    const draft = getSignupDraft();
    return draft?.email === state.email ? draft.values : EMPTY_VALUES;
  }

  return {
    name: profile.name,
    type: profile.type,
    studentNumber: profile.student_number ?? "",
    classNo: profile.class_no?.toString() ?? "",
    cohort: profile.cohort?.toString() ?? "",
    gender: profile.gender ?? "",
    academicTrack: profile.academic_track ?? "",
    phoneNumber: profile.phone_number ?? "",
    birthday: profile.birthday ?? "",
    dormRoom: profile.dorm_room?.toString() ?? "",
  };
}

export async function clientLoader() {
  const state = await loadAuthState();
  if (!state) throw redirect("/signup");

  if (state.profile && state.profile.status !== "draft") {
    const destination = getProfileDestination(state.profile);
    if (destination === "/login") await signOut();
    throw redirect(destination);
  }

  return { ...state, values: initialValues(state) };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const values = readProfileForm(formData);
  const errors = validateProfileForm(values);

  if (hasErrors(errors)) {
    return data({ errors, values }, { status: 400 });
  }

  try {
    await submitProfile(values);
    throw redirect("/pending");
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { errors: { form: getAuthErrorMessage(error) }, values },
      { status: 400 },
    );
  }
}

export default function SetupPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  const values = actionData?.values ?? loaderData.values;
  const errors: FieldErrors = actionData?.errors ?? {};

  return (
    <AuthCard
      title={loaderData.profile ? "가입 정보 재제출" : "프로필 설정"}
      description={
        loaderData.profile
          ? "입력한 정보를 확인하고 필요한 내용을 수정한 뒤 다시 제출해 주세요."
          : "확인에 필요한 정보입니다. 승인 전에는 기능이 제한됩니다."
      }
      wide
    >
      <Form method="post" className="flex flex-col gap-8">
        {errors.form ? <FieldError>{errors.form}</FieldError> : null}

        <ProfileFields values={values} errors={errors} disabled={pending} />

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          가입 신청 제출
        </Button>
      </Form>
    </AuthCard>
  );
}
