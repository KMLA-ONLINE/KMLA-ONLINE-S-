import { useState } from "react";

import type {
  FieldErrors,
  ProfileFormValues,
} from "~/features/auth/model/types";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/shared/ui/field";
import { DateSelect } from "~/shared/ui/date-select";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { TextField } from "~/shared/ui/text-field";

/**
 * 학교 프로필 입력 묶음. 가입 마법사의 프로필 단계와 `/setup`의 재제출 화면이 함께 쓴다.
 *
 * 사용자 유형만 이 안에서 상태를 들고 있다. 유형에 따라 보여줄 칸이 달라지는데, 그 분기를
 * 두 화면이 각자 복제하면 필수 항목 규칙이 서로 어긋나기 시작한다.
 */
export function ProfileFields({
  values,
  errors,
  disabled,
}: {
  values: ProfileFormValues;
  errors: FieldErrors;
  disabled?: boolean;
}) {
  const [profileType, setProfileType] = useState(values.type);
  const isStudent = profileType === "student";
  const isAlumni = profileType === "alumni";
  const needsAcademicInfo = isStudent || isAlumni;

  return (
    <>
      {/*
        반과 기숙사 방은 가입 단계에서 묻지 않는다. 승인 뒤 프로필 설정에서 채우는 항목인데,
        `submit_my_profile`은 넘어온 값으로 두 열을 통째로 덮어쓴다. 재제출이 이미 채워 둔
        값을 조용히 지우지 않도록, 화면에 내보이지 않고 값만 그대로 실어 보낸다.
      */}
      <input type="hidden" name="classNo" value={values.classNo} />
      <input type="hidden" name="dormRoom" value={values.dormRoom} />

      <FieldSet>
        <FieldLegend>기본 정보</FieldLegend>
        <FieldGroup className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="profile-name">이름</FieldLabel>
            <TextField
              id="profile-name"
              name="name"
              defaultValue={values.name}
              aria-invalid={Boolean(errors.name)}
              disabled={disabled}
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
              disabled={disabled}
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
              <TextField
                id="student-number"
                name="studentNumber"
                inputMode="numeric"
                maxLength={6}
                defaultValue={values.studentNumber}
                aria-invalid={Boolean(errors.studentNumber)}
                disabled={disabled}
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
                defaultValue={values.cohort}
                aria-invalid={Boolean(errors.cohort)}
                disabled={disabled}
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
                defaultValue={values.academicTrack}
                aria-invalid={Boolean(errors.academicTrack)}
                disabled={disabled}
                required
              >
                <NativeSelectOption value="">선택해 주세요</NativeSelectOption>
                <NativeSelectOption value="domestic">국내반</NativeSelectOption>
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
                defaultValue={values.gender}
                aria-invalid={Boolean(errors.gender)}
                disabled={disabled}
                required
              >
                <NativeSelectOption value="">선택해 주세요</NativeSelectOption>
                <NativeSelectOption value="male">남성</NativeSelectOption>
                <NativeSelectOption value="female">여성</NativeSelectOption>
              </NativeSelect>
              <FieldError>{errors.gender}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.birthday)}>
              <FieldLabel htmlFor="birthday">
                생년월일 {isAlumni ? "(선택)" : ""}
              </FieldLabel>
              <DateSelect
                id="birthday"
                name="birthday"
                defaultValue={values.birthday}
                aria-invalid={Boolean(errors.birthday)}
                disabled={disabled}
                required={isStudent}
              />
              <FieldError>{errors.birthday}</FieldError>
            </Field>
          </FieldGroup>
        </FieldSet>
      ) : null}

      {profileType !== "alumni" ? (
        <FieldSet>
          <FieldLegend>연락처</FieldLegend>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.phoneNumber)}>
              <FieldLabel htmlFor="phone-number">전화번호 (추천)</FieldLabel>
              <Input
                id="phone-number"
                name="phoneNumber"
                type="tel"
                placeholder="010-1234-5678"
                defaultValue={values.phoneNumber}
                aria-invalid={Boolean(errors.phoneNumber)}
                disabled={disabled}
              />
              <FieldError>{errors.phoneNumber}</FieldError>
            </Field>
          </FieldGroup>
        </FieldSet>
      ) : null}
    </>
  );
}
