import { useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { data, Form, redirect, useNavigation } from "react-router";

import {
  AuthCard,
  getAuthErrorMessage,
  getPendingSignupEmail,
  getProfileDestination,
  hasErrors,
  loadAuthState,
  readFormText,
  readProfileForm,
  resendSignupOtp,
  signOut,
  submitProfile,
  validateProfileForm,
  verifySignupOtp,
  type FieldErrors,
  type ProfileFormValues,
} from "~/features/auth";
import { Button } from "~/shared/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "~/shared/ui/input-otp";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/setup";

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
  otp: "",
};

export async function clientLoader() {
  const state = await loadAuthState();

  if (!state) {
    const email = getPendingSignupEmail();
    if (!email) throw redirect("/signup");
    return { email, profile: null, requiresOtp: true };
  }

  if (state.profile && state.profile.status !== "rejected") {
    const destination = getProfileDestination(state.profile);
    if (destination === "/login") await signOut();
    throw redirect(destination);
  }

  return { ...state, requiresOtp: false };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = readFormText(formData, "intent");
  const email = readFormText(formData, "email");

  if (intent === "resend") {
    try {
      await resendSignupOtp(email);
      return data({ resendSent: true });
    } catch (error) {
      return data(
        { errors: { form: getAuthErrorMessage(error) } },
        { status: 400 },
      );
    }
  }

  const values = readProfileForm(formData);
  const state = await loadAuthState();
  const requiresOtp = !state;
  const errors = validateProfileForm(values, requiresOtp);

  if (hasErrors(errors)) {
    return data({ errors, values }, { status: 400 });
  }

  try {
    if (requiresOtp) await verifySignupOtp(email, values.otp);
    await submitProfile(values);
    throw redirect("/pending");
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      {
        errors: { form: getAuthErrorMessage(error) },
        values,
      },
      { status: 400 },
    );
  }
}

function valuesFromLoader(
  loaderData: Route.ComponentProps["loaderData"],
): ProfileFormValues {
  const profile = loaderData.profile;
  if (!profile) return EMPTY_VALUES;

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
    otp: "",
  };
}

export default function SetupPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  const initialValues =
    actionData && "values" in actionData
      ? actionData.values
      : valuesFromLoader(loaderData);
  const errors: FieldErrors =
    actionData && "errors" in actionData ? actionData.errors : {};
  const [profileType, setProfileType] = useState(initialValues.type);
  const isStudent = profileType === "student";
  const isAlumni = profileType === "alumni";
  const needsAcademicInfo = isStudent || isAlumni;

  return (
    <AuthCard
      title={loaderData.profile ? "가입 정보 다시 제출" : "학교 프로필 설정"}
      description={
        loaderData.profile
          ? "거절된 내용을 확인하고 정보를 수정해 다시 제출해 주세요."
          : "학교 구성원 확인에 필요한 정보입니다. 승인 전에는 커뮤니티 기능이 제한됩니다."
      }
      wide
    >
      <Form method="post" className="flex flex-col gap-8">
        <input type="hidden" name="email" value={loaderData.email} />
        {errors.form ? <FieldError>{errors.form}</FieldError> : null}
        {actionData && "resendSent" in actionData && actionData.resendSent ? (
          <p role="status" className="text-sm text-primary">
            인증 코드를 다시 보냈습니다.
          </p>
        ) : null}

        <FieldSet>
          <FieldLegend>기본 정보</FieldLegend>
          <FieldGroup className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="profile-name">이름</FieldLabel>
              <Input
                id="profile-name"
                name="name"
                defaultValue={initialValues.name}
                aria-invalid={Boolean(errors.name)}
                disabled={pending}
                required
              />
              <FieldError>{errors.name}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.type)}>
              <FieldLabel htmlFor="profile-type">사용자 유형</FieldLabel>
              <NativeSelect
                id="profile-type"
                name="type"
                className="w-full"
                value={profileType}
                onChange={(event) => setProfileType(event.target.value)}
                aria-invalid={Boolean(errors.type)}
                disabled={pending}
              >
                <NativeSelectOption value="student">재학생</NativeSelectOption>
                <NativeSelectOption value="alumni">졸업생</NativeSelectOption>
                <NativeSelectOption value="teacher">교사</NativeSelectOption>
              </NativeSelect>
              <FieldError>{errors.type}</FieldError>
            </Field>
          </FieldGroup>
        </FieldSet>

        {needsAcademicInfo ? (
          <FieldSet>
            <FieldLegend>학적 정보</FieldLegend>
            <FieldGroup className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.studentNumber)}>
                <FieldLabel htmlFor="student-number">
                  학번 {isAlumni ? "(선택)" : ""}
                </FieldLabel>
                <Input
                  id="student-number"
                  name="studentNumber"
                  inputMode="numeric"
                  maxLength={6}
                  defaultValue={initialValues.studentNumber}
                  aria-invalid={Boolean(errors.studentNumber)}
                  disabled={pending}
                  required={isStudent}
                />
                <FieldError>{errors.studentNumber}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.cohort)}>
                <FieldLabel htmlFor="cohort">기수</FieldLabel>
                <Input
                  id="cohort"
                  name="cohort"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={initialValues.cohort}
                  aria-invalid={Boolean(errors.cohort)}
                  disabled={pending}
                  required
                />
                <FieldError>{errors.cohort}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.academicTrack)}>
                <FieldLabel htmlFor="academic-track">계열</FieldLabel>
                <NativeSelect
                  id="academic-track"
                  name="academicTrack"
                  className="w-full"
                  defaultValue={initialValues.academicTrack}
                  aria-invalid={Boolean(errors.academicTrack)}
                  disabled={pending}
                  required
                >
                  <NativeSelectOption value="">
                    선택해 주세요
                  </NativeSelectOption>
                  <NativeSelectOption value="domestic">
                    국내반
                  </NativeSelectOption>
                  <NativeSelectOption value="international">
                    국제반
                  </NativeSelectOption>
                </NativeSelect>
                <FieldError>{errors.academicTrack}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.gender)}>
                <FieldLabel htmlFor="gender">성별</FieldLabel>
                <NativeSelect
                  id="gender"
                  name="gender"
                  className="w-full"
                  defaultValue={initialValues.gender}
                  aria-invalid={Boolean(errors.gender)}
                  disabled={pending}
                  required
                >
                  <NativeSelectOption value="">
                    선택해 주세요
                  </NativeSelectOption>
                  <NativeSelectOption value="male">남성</NativeSelectOption>
                  <NativeSelectOption value="female">여성</NativeSelectOption>
                </NativeSelect>
                <FieldError>{errors.gender}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.birthday)}>
                <FieldLabel htmlFor="birthday">
                  생년월일 {isAlumni ? "(선택)" : ""}
                </FieldLabel>
                <Input
                  id="birthday"
                  name="birthday"
                  type="date"
                  defaultValue={initialValues.birthday}
                  aria-invalid={Boolean(errors.birthday)}
                  disabled={pending}
                  required={isStudent}
                />
                <FieldError>{errors.birthday}</FieldError>
              </Field>
              {isStudent ? (
                <>
                  <Field data-invalid={Boolean(errors.classNo)}>
                    <FieldLabel htmlFor="class-no">반 (선택)</FieldLabel>
                    <Input
                      id="class-no"
                      name="classNo"
                      type="number"
                      min={1}
                      max={20}
                      defaultValue={initialValues.classNo}
                      aria-invalid={Boolean(errors.classNo)}
                      disabled={pending}
                    />
                    <FieldError>{errors.classNo}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(errors.dormRoom)}>
                    <FieldLabel htmlFor="dorm-room">
                      기숙사 방 (선택)
                    </FieldLabel>
                    <Input
                      id="dorm-room"
                      name="dormRoom"
                      type="number"
                      min={1}
                      max={999}
                      defaultValue={initialValues.dormRoom}
                      aria-invalid={Boolean(errors.dormRoom)}
                      disabled={pending}
                    />
                    <FieldError>{errors.dormRoom}</FieldError>
                  </Field>
                </>
              ) : null}
            </FieldGroup>
          </FieldSet>
        ) : null}

        {profileType !== "alumni" ? (
          <FieldSet>
            <FieldLegend>연락처</FieldLegend>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.phoneNumber)}>
                <FieldLabel htmlFor="phone-number">전화번호 (선택)</FieldLabel>
                <Input
                  id="phone-number"
                  name="phoneNumber"
                  type="tel"
                  placeholder="010-1234-5678"
                  defaultValue={initialValues.phoneNumber}
                  aria-invalid={Boolean(errors.phoneNumber)}
                  disabled={pending}
                />
                <FieldError>{errors.phoneNumber}</FieldError>
              </Field>
            </FieldGroup>
          </FieldSet>
        ) : null}

        {loaderData.requiresOtp ? (
          <FieldSet>
            <FieldLegend>이메일 인증</FieldLegend>
            <FieldDescription>
              {loaderData.email}로 보낸 숫자 6자리를 입력해 주세요.
            </FieldDescription>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.otp)}>
                <FieldLabel htmlFor="signup-otp">인증 코드</FieldLabel>
                <InputOTP
                  id="signup-otp"
                  name="otp"
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  defaultValue={initialValues.otp}
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
          </FieldSet>
        ) : null}

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          가입 신청 제출
        </Button>
      </Form>
    </AuthCard>
  );
}
