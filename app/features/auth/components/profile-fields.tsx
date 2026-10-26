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
import { useT } from "~/shared/i18n";
import { DateSelect } from "~/shared/ui/date-select";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { TextField } from "~/shared/ui/text-field";

/**
 * 가입 프로필 단계와 `/setup` 재제출이 공유한다.
 * 유형별 분기를 한 곳에 둬야 필수 항목 규칙이 어긋나지 않는다. 선택 정보는 개인정보
 * 처리방침 2항과 같아야 하며 라벨에 "(선택)"을 붙인다.
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
  const t = useT();
  const [profileType, setProfileType] = useState(values.type);
  const isStudent = profileType === "student";
  const isAlumni = profileType === "alumni";
  const needsAcademicInfo = isStudent || isAlumni;

  return (
    <>
      {/* 반·기숙사 방은 가입 때 묻지 않지만, `submit_my_profile`이 두 열을 덮어쓰므로 기존 값을 그대로 실어 보낸다. */}
      <input type="hidden" name="classNo" value={values.classNo} />
      <input type="hidden" name="dormRoom" value={values.dormRoom} />

      <FieldSet>
        <FieldLegend>{t("기본 정보")}</FieldLegend>
        <FieldGroup className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="profile-name">{t("이름")}</FieldLabel>
            <TextField
              id="profile-name"
              name="name"
              placeholder="홍길동"
              defaultValue={values.name}
              aria-invalid={Boolean(errors.name)}
              disabled={disabled}
              required
            />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.type)}>
            <FieldLabel htmlFor="profile-type">{t("사용자 유형")}</FieldLabel>
            <NativeSelect
              id="profile-type"
              name="type"
              className="w-full"
              value={profileType}
              onChange={(event) => setProfileType(event.target.value)}
              aria-invalid={Boolean(errors.type)}
              disabled={disabled}
            >
              <NativeSelectOption value="student">
                {t("재학생")}
              </NativeSelectOption>
              <NativeSelectOption value="alumni">
                {t("졸업생")}
              </NativeSelectOption>
              <NativeSelectOption value="teacher">
                {t("교사")}
              </NativeSelectOption>
            </NativeSelect>
            <FieldError>{errors.type}</FieldError>
          </Field>
        </FieldGroup>
      </FieldSet>

      {needsAcademicInfo ? (
        <FieldSet>
          <FieldLegend>{t("학적 정보")}</FieldLegend>
          <FieldGroup className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.studentNumber)}>
              <FieldLabel htmlFor="student-number">
                {t("학번")} {isAlumni ? t("(선택)") : ""}
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
              <FieldLabel htmlFor="cohort">{t("기수")}</FieldLabel>
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
              <FieldLabel htmlFor="academic-track">
                {t("계열 (선택)")}
              </FieldLabel>
              <NativeSelect
                id="academic-track"
                name="academicTrack"
                className="w-full"
                defaultValue={values.academicTrack}
                aria-invalid={Boolean(errors.academicTrack)}
                disabled={disabled}
              >
                <NativeSelectOption value="">
                  {t("선택 안 함")}
                </NativeSelectOption>
                <NativeSelectOption value="domestic">
                  {t("국내반")}
                </NativeSelectOption>
                <NativeSelectOption value="international">
                  {t("국제반")}
                </NativeSelectOption>
              </NativeSelect>
              <FieldError>{errors.academicTrack}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.gender)}>
              <FieldLabel htmlFor="gender">{t("성별 (선택)")}</FieldLabel>
              <NativeSelect
                id="gender"
                name="gender"
                className="w-full"
                defaultValue={values.gender}
                aria-invalid={Boolean(errors.gender)}
                disabled={disabled}
              >
                <NativeSelectOption value="">
                  {t("선택 안 함")}
                </NativeSelectOption>
                <NativeSelectOption value="male">
                  {t("남성")}
                </NativeSelectOption>
                <NativeSelectOption value="female">
                  {t("여성")}
                </NativeSelectOption>
              </NativeSelect>
              <FieldError>{errors.gender}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.birthday)}>
              <FieldLabel htmlFor="birthday">{t("생년월일 (선택)")}</FieldLabel>
              <DateSelect
                id="birthday"
                name="birthday"
                defaultValue={values.birthday}
                aria-invalid={Boolean(errors.birthday)}
                disabled={disabled}
              />
              <FieldError>{errors.birthday}</FieldError>
            </Field>
          </FieldGroup>
        </FieldSet>
      ) : null}

      {profileType !== "alumni" ? (
        <FieldSet>
          <FieldLegend>{t("연락처")}</FieldLegend>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.phoneNumber)}>
              <FieldLabel htmlFor="phone-number">
                {t("전화번호 (선택)")}
              </FieldLabel>
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
