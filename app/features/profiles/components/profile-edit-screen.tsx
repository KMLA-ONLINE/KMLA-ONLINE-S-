import { useRef } from "react";
import { Form, Link, useNavigation } from "react-router";

import type {
  EditableProfile,
  ProfileEditActionData,
  ProfileEditValues,
} from "~/features/profiles/model/types";
import { Button, buttonVariants } from "~/shared/ui/button";
import { Card, CardContent } from "~/shared/ui/card";
import { Checkbox } from "~/shared/ui/checkbox";
import { Field, FieldError, FieldLabel } from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

export function ProfileEditScreen({
  profile,
  departments,
  actionData,
}: {
  profile: EditableProfile;
  departments: string[];
  actionData?: ProfileEditActionData;
}) {
  return (
    <main className="px-3 pb-6 md:px-0 md:pb-10">
      <div className="w-full">
        <ProfileEditForm
          profile={profile}
          departments={departments}
          actionData={actionData}
        />
      </div>
    </main>
  );
}

function initialValues(profile: EditableProfile): ProfileEditValues {
  return {
    name: profile.name,
    description: profile.description ?? "",
    birthday: profile.birthday ?? "",
    phoneNumber: profile.phone_number ?? "",
    contactEmail: profile.contact_email ?? "",
    gender: profile.gender,
    cohort: profile.cohort,
    academicTrack: profile.academic_track,
    department: profile.department ?? "",
    classNo: profile.class_no,
    dormRoom: profile.dorm_room,
    allowTimelinePosts: profile.allow_timeline_posts,
    isReturningStudent: profile.is_returning_student,
  };
}

function ProfileEditForm({
  profile,
  departments,
  actionData,
}: {
  profile: EditableProfile;
  departments: string[];
  actionData?: ProfileEditActionData;
}) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  const values = actionData?.values ?? initialValues(profile);
  const errors = actionData?.errors ?? {};
  const academicProfile =
    profile.type === "student" || profile.type === "alumni";
  const cohortInputRef = useRef<HTMLInputElement>(null);
  const returningInputRef = useRef<HTMLInputElement>(null);
  const returningStateRef = useRef<HTMLSpanElement>(null);

  return (
    <Card className="-mx-3 gap-4 rounded-none border-x-0 py-4 sm:mx-0 sm:gap-6 sm:rounded-xl sm:border-x sm:py-6">
      <CardContent className="px-3 sm:px-6">
        <Form method="post" className="space-y-5 sm:space-y-7">
          {errors.form ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {errors.form}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
            <Field
              data-invalid={Boolean(errors.name)}
              className="sm:col-span-2"
            >
              <FieldLabel htmlFor="profile-name">이름</FieldLabel>
              <Input
                id="profile-name"
                name="name"
                defaultValue={values.name}
                maxLength={50}
                required
                aria-invalid={Boolean(errors.name)}
              />
              <FieldError>{errors.name}</FieldError>
            </Field>

            <Field
              data-invalid={Boolean(errors.description)}
              className="sm:col-span-2"
            >
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="profile-description">소개</FieldLabel>
                <span className="text-xs text-muted-foreground">
                  최대 500자
                </span>
              </div>
              <Textarea
                id="profile-description"
                name="description"
                defaultValue={values.description}
                maxLength={500}
                rows={5}
                className="resize-y"
                aria-invalid={Boolean(errors.description)}
              />
              <FieldError>{errors.description}</FieldError>
            </Field>

            <Field orientation="horizontal" className="sm:col-span-2">
              <Checkbox
                id="profile-timeline-posts"
                name="allowTimelinePosts"
                defaultChecked={values.allowTimelinePosts}
              />
              <div>
                <FieldLabel htmlFor="profile-timeline-posts">
                  다른 사용자의 내 타임라인 게시물 작성 허용
                </FieldLabel>
              </div>
            </Field>
          </div>

          {academicProfile ? (
            <section className="space-y-5 border-t pt-6">
              <div>
                <h2 className="font-semibold">학교 정보</h2>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
                <Field data-invalid={Boolean(errors.gender)}>
                  <FieldLabel htmlFor="profile-gender">성별</FieldLabel>
                  <NativeSelect
                    id="profile-gender"
                    name="gender"
                    defaultValue={values.gender ?? ""}
                    required
                    aria-invalid={Boolean(errors.gender)}
                    className="w-full"
                  >
                    <NativeSelectOption value="male">남성</NativeSelectOption>
                    <NativeSelectOption value="female">여성</NativeSelectOption>
                  </NativeSelect>
                  <FieldError>{errors.gender}</FieldError>
                </Field>

                <Field data-invalid={Boolean(errors.academicTrack)}>
                  <FieldLabel htmlFor="profile-track">계열</FieldLabel>
                  <NativeSelect
                    id="profile-track"
                    name="academicTrack"
                    defaultValue={values.academicTrack ?? ""}
                    required
                    aria-invalid={Boolean(errors.academicTrack)}
                    className="w-full"
                  >
                    <NativeSelectOption value="domestic">
                      국내 계열
                    </NativeSelectOption>
                    <NativeSelectOption value="international">
                      국제 계열
                    </NativeSelectOption>
                  </NativeSelect>
                  <FieldError>{errors.academicTrack}</FieldError>
                </Field>

                {profile.type === "student" ? (
                  <>
                    <Field
                      data-invalid={Boolean(errors.department)}
                      className="sm:col-span-2"
                    >
                      <FieldLabel htmlFor="profile-department">부서</FieldLabel>

                      <NativeSelect
                        id="profile-department"
                        name="department"
                        defaultValue={values.department}
                        aria-invalid={Boolean(errors.department)}
                        className="w-full"
                      >
                        <NativeSelectOption value="">없음</NativeSelectOption>

                        {values.department &&
                        !departments.includes(values.department) ? (
                          <NativeSelectOption value={values.department}>
                            {values.department}
                          </NativeSelectOption>
                        ) : null}

                        {departments.map((department) => (
                          <NativeSelectOption
                            key={department}
                            value={department}
                          >
                            {department}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>

                      <FieldError>{errors.department}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(errors.classNo)}>
                      <FieldLabel htmlFor="profile-class">반</FieldLabel>
                      <Input
                        id="profile-class"
                        name="classNo"
                        type="text"
                        inputMode="numeric"
                        pattern="(?:[1-9]|10)"
                        maxLength={2}
                        defaultValue={values.classNo ?? ""}
                        placeholder="예: 3"
                        aria-invalid={Boolean(errors.classNo)}
                        onInput={(event) => {
                          let value = event.currentTarget.value
                            .replace(/\D/g, "")
                            .slice(0, 2);

                          if (value === "0") value = "";

                          if (Number(value) > 10) {
                            value = "10";
                          }

                          event.currentTarget.value = value;
                        }}
                      />
                      <FieldError>{errors.classNo}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(errors.dormRoom)}>
                      <FieldLabel htmlFor="profile-dorm">기숙사 방</FieldLabel>
                      <Input
                        id="profile-dorm"
                        name="dormRoom"
                        type="text"
                        inputMode="numeric"
                        pattern="(?:[1-9][0-9]{0,2}|100[0-4])"
                        maxLength={4}
                        defaultValue={values.dormRoom ?? ""}
                        placeholder="예: 305"
                        aria-invalid={Boolean(errors.dormRoom)}
                        onInput={(event) => {
                          let value = event.currentTarget.value
                            .replace(/\D/g, "")
                            .slice(0, 4);

                          if (value === "0") value = "";

                          if (Number(value) > 1004) {
                            value = "1004";
                          }

                          event.currentTarget.value = value;
                        }}
                      />
                      <FieldError>{errors.dormRoom}</FieldError>
                    </Field>
                  </>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="space-y-5 border-t pt-6">
            <div>
              <h2 className="font-semibold">기본 정보 및 연락처</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
              {academicProfile ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="profile-cohort">기수</FieldLabel>
                    <Input
                      ref={cohortInputRef}
                      id="profile-cohort"
                      defaultValue={
                        profile.cohort === null
                          ? ""
                          : profile.cohort +
                            (values.isReturningStudent ? 0.5 : 0)
                      }
                      disabled
                      readOnly
                    />
                  </Field>

                  {profile.student_number ? (
                    <Field>
                      <FieldLabel htmlFor="profile-student-number">
                        학번
                      </FieldLabel>
                      <Input
                        id="profile-student-number"
                        value={profile.student_number}
                        disabled
                        readOnly
                      />
                    </Field>
                  ) : null}
                </>
              ) : null}

              <Field data-invalid={Boolean(errors.birthday)}>
                <FieldLabel htmlFor="profile-birthday">생일</FieldLabel>
                <Input
                  id="profile-birthday"
                  name="birthday"
                  type="date"
                  min="1900-01-01"
                  defaultValue={values.birthday}
                  required={profile.type === "student"}
                  aria-invalid={Boolean(errors.birthday)}
                />
                <FieldError>{errors.birthday}</FieldError>
              </Field>

              <Field data-invalid={Boolean(errors.phoneNumber)}>
                <FieldLabel htmlFor="profile-phone">전화번호</FieldLabel>
                <Input
                  id="profile-phone"
                  name="phoneNumber"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={13}
                  pattern="010-[0-9]{4}-[0-9]{4}"
                  defaultValue={values.phoneNumber}
                  placeholder="010-1234-5678"
                  aria-invalid={Boolean(errors.phoneNumber)}
                  onInput={(event) => {
                    const digits = event.currentTarget.value
                      .replace(/\D/g, "")
                      .slice(0, 11);

                    let value = digits;

                    if (digits.length > 3) {
                      value = `${digits.slice(0, 3)}-${digits.slice(3)}`;
                    }

                    if (digits.length > 7) {
                      value = `${digits.slice(0, 3)}-${digits.slice(
                        3,
                        7,
                      )}-${digits.slice(7)}`;
                    }

                    event.currentTarget.value = value;
                  }}
                />
                <FieldError>{errors.phoneNumber}</FieldError>
              </Field>

              <Field
                data-invalid={Boolean(errors.contactEmail)}
                className="sm:col-span-2"
              >
                <FieldLabel htmlFor="profile-contact-email">
                  연락용 이메일
                </FieldLabel>
                <Input
                  id="profile-contact-email"
                  name="contactEmail"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  defaultValue={values.contactEmail}
                  placeholder="name@example.com"
                  aria-invalid={Boolean(errors.contactEmail)}
                />
                <FieldError>{errors.contactEmail}</FieldError>
              </Field>

              {profile.type === "student" ? (
                <Field className="sm:col-span-2">
                  <div className="flex items-center justify-between gap-4 py-1">
                    <FieldLabel>복학 여부</FieldLabel>

                    <input
                      ref={returningInputRef}
                      type="hidden"
                      name="isReturningStudent"
                      defaultValue={values.isReturningStudent ? "on" : ""}
                    />

                    <button
                      type="button"
                      role="switch"
                      data-state={values.isReturningStudent ? "on" : "off"}
                      aria-checked={values.isReturningStudent}
                      className="group inline-flex shrink-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={(event) => {
                        const button = event.currentTarget;
                        const isOn = button.dataset.state === "on";
                        const next = !isOn;

                        button.dataset.state = next ? "on" : "off";
                        button.setAttribute("aria-checked", String(next));

                        if (returningInputRef.current) {
                          returningInputRef.current.value = next ? "on" : "";
                        }

                        if (cohortInputRef.current && profile.cohort !== null) {
                          cohortInputRef.current.value = String(
                            profile.cohort + (next ? 0.5 : 0),
                          );
                        }

                        if (returningStateRef.current) {
                          returningStateRef.current.textContent = next
                            ? "ON"
                            : "OFF";
                        }
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="relative h-6 w-11 rounded-full bg-muted-foreground/30 transition-colors group-data-[state=on]:bg-primary"
                      >
                        <span className="absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow-sm transition-transform group-data-[state=on]:translate-x-5" />
                      </span>

                      <span
                        ref={returningStateRef}
                        className="w-7 text-xs font-semibold text-muted-foreground"
                      >
                        {values.isReturningStudent ? "ON" : "OFF"}
                      </span>
                    </button>
                  </div>
                </Field>
              ) : null}
            </div>
          </section>

          <div className="flex flex-col-reverse gap-2 border-t pt-5 pb-1 sm:flex-row sm:justify-end sm:pt-6 sm:pb-0">
            <Link
              to={`/profile/${profile.pub_id}`}
              className={buttonVariants({
                variant: "outline",
                className: "w-full justify-center sm:w-auto",
              })}
            >
              취소
            </Link>
            <Button
              type="submit"
              disabled={pending}
              className="w-full sm:w-auto"
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              저장
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
