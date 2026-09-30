import { ChevronRightIcon } from "lucide-react";
import { useRef, type ReactNode, type SyntheticEvent } from "react";
import { Form, Link, useNavigation } from "react-router";

import type {
  EditableProfile,
  ProfileEditActionData,
  ProfileEditValues,
} from "~/features/profiles/model/types";
import { Button, buttonVariants } from "~/shared/ui/button";
import { Card, CardContent } from "~/shared/ui/card";
import { Checkbox } from "~/shared/ui/checkbox";
import { DateSelect } from "~/shared/ui/date-select";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";
import { TextField } from "~/shared/ui/text-field";
import { Textarea } from "~/shared/ui/textarea";

const GENDER_LABELS: Record<string, string> = {
  male: "남성",
  female: "여성",
};

const TRACK_LABELS: Record<string, string> = {
  domestic: "국내 계열",
  international: "국제 계열",
};

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
    <main className="px-3 pb-0 md:px-0 md:pb-10">
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

/** 필수 항목 별표. `FieldLabel`이 `flex gap-2`라 라벨 글자와 같은 span에 담아야 붙는다. 시각 전용이고 스크린리더는 `required`로 안다. */
function RequiredLabel({ children }: { children: ReactNode }) {
  return (
    <span>
      {children}
      <span aria-hidden="true" className="ml-0.5 text-destructive">
        *
      </span>
    </span>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-medium text-muted-foreground">{children}</h2>
  );
}

function initialValues(profile: EditableProfile): ProfileEditValues {
  return {
    pubId: profile.pub_id,
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

function formatBirthday(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return "";

  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

/** 접어 둔 신원 정보의 현재 값을 한 줄로 보여 준다(감추는 건 고칠 수 있다는 사실이지 값이 아니다). */
function identitySummary(values: ProfileEditValues): string {
  return [
    `@${values.pubId}`,
    values.name,
    formatBirthday(values.birthday),
    values.gender ? GENDER_LABELS[values.gender] : "",
    values.academicTrack ? TRACK_LABELS[values.academicTrack] : "",
  ]
    .filter(Boolean)
    .join(" · ");
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
  const isStudent = profile.type === "student";
  const academicProfile = isStudent || profile.type === "alumni";
  const returningInputRef = useRef<HTMLInputElement>(null);
  const identityRef = useRef<HTMLDetailsElement>(null);

  const identityHasError = [
    errors.pubId,
    errors.name,
    errors.birthday,
    errors.gender,
    errors.academicTrack,
  ].some(Boolean);

  /**
   * 접힌 칸의 빈 `required` 입력은 포커스할 데가 없어 제출이 조용히 취소된다. 브라우저가 알리기 전에 펼친다.
   * `invalid`는 버블링하지 않아 캡처로 받는다.
   */
  function openIdentityOnInvalid(event: SyntheticEvent<HTMLFormElement>) {
    const details = identityRef.current;

    if (details && !details.open && details.contains(event.target as Node)) {
      details.open = true;
    }
  }

  return (
    <Form
      method="post"
      onInvalidCapture={openIdentityOnInvalid}
      className="space-y-4"
    >
      <Card className="-mx-3 gap-4 rounded-none border-x-0 py-4 sm:mx-0 sm:gap-6 sm:rounded-xl sm:border-x sm:py-6">
        <CardContent className="space-y-5 px-3 sm:space-y-7 sm:px-6">
          {errors.form ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {errors.form}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-4 sm:gap-5">
            <Field
              data-invalid={Boolean(errors.description)}
              className="sm:col-span-4"
            >
              <FieldLabel htmlFor="profile-description">소개</FieldLabel>
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

            {isStudent ? (
              <>
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
                    placeholder="1 ~ 10"
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
                    pattern="(?:10[1-9]|1[1-9][0-9]|[2-9][0-9]{2}|100[0-8])"
                    maxLength={4}
                    defaultValue={values.dormRoom ?? ""}
                    placeholder="예: 101"
                    aria-invalid={Boolean(errors.dormRoom)}
                    onInput={(event) => {
                      let value = event.currentTarget.value
                        .replace(/\D/g, "")
                        .slice(0, 4);

                      if (value === "0") value = "";

                      if (Number(value) > 1008) {
                        value = "1008";
                      }

                      event.currentTarget.value = value;
                    }}
                  />
                  <FieldError>{errors.dormRoom}</FieldError>
                </Field>

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
                      <NativeSelectOption key={department} value={department}>
                        {department}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldError>{errors.department}</FieldError>
                </Field>
              </>
            ) : null}
          </div>

          <section className="space-y-4 border-t pt-5 sm:space-y-5 sm:pt-6">
            <SectionTitle>연락처</SectionTitle>

            <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
              <Field data-invalid={Boolean(errors.phoneNumber)}>
                <FieldLabel htmlFor="profile-phone">전화번호(추천)</FieldLabel>
                <Input
                  id="profile-phone"
                  name="phoneNumber"
                  type="tel"
                  inputMode="tel"
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

              <Field data-invalid={Boolean(errors.contactEmail)}>
                <FieldLabel htmlFor="profile-contact-email">
                  연락용 이메일
                </FieldLabel>
                <Input
                  id="profile-contact-email"
                  name="contactEmail"
                  type="email"
                  maxLength={254}
                  defaultValue={values.contactEmail}
                  placeholder="name@example.com"
                  aria-invalid={Boolean(errors.contactEmail)}
                />
                <FieldError>{errors.contactEmail}</FieldError>
              </Field>
            </div>
          </section>

          <section className="space-y-4 border-t pt-5 sm:space-y-5 sm:pt-6">
            <SectionTitle>설정</SectionTitle>

            <Field orientation="horizontal">
              <Checkbox
                id="profile-timeline-posts"
                name="allowTimelinePosts"
                defaultChecked={values.allowTimelinePosts}
              />
              <div>
                <FieldLabel htmlFor="profile-timeline-posts">
                  다른 사용자의 내 타임라인 게시물 작성 허용(추천)
                </FieldLabel>
              </div>
            </Field>

            {isStudent ? (
              <Field>
                <div className="flex items-center justify-between gap-4">
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
                    aria-describedby="profile-returning-description"
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
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="relative h-6 w-11 rounded-full bg-muted-foreground/30 transition-colors group-data-[state=on]:bg-primary"
                    >
                      <span className="absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow-sm transition-transform group-data-[state=on]:translate-x-5" />
                    </span>
                  </button>
                </div>

                <FieldDescription id="profile-returning-description">
                  복학 여부 설정에 따라 제공되는 기능이 달라집니다. 실제 상태와
                  다를 경우 불편이 존재할 수 있습니다.
                </FieldDescription>
              </Field>
            ) : null}
          </section>

          {/* 신원 정보는 고칠 일이 거의 없어 접어 둔다. 요약 줄로 값은 계속 보인다. */}
          <details
            ref={identityRef}
            open={identityHasError || undefined}
            className="group/identity border-t pt-5 sm:pt-6"
          >
            <summary className="-m-1 flex cursor-pointer list-none items-center gap-3 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open/identity:rotate-90"
              />

              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">신원 정보</span>
                <span className="block truncate text-xs text-muted-foreground group-open/identity:hidden">
                  {identitySummary(values)}
                </span>
              </div>

              <span className="shrink-0 text-xs text-muted-foreground group-open/identity:hidden">
                수정
              </span>
            </summary>

            <div className="grid gap-4 pt-5 sm:grid-cols-2 sm:gap-5">
              <Field
                data-invalid={Boolean(errors.pubId)}
                className="sm:col-span-2"
              >
                <FieldLabel htmlFor="profile-slug">
                  <RequiredLabel>slug</RequiredLabel>
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-sm text-muted-foreground"
                  >
                    /profile/
                  </span>
                  <Input
                    id="profile-slug"
                    name="pubId"
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    pattern="[a-z0-9][a-z0-9-]{3,13}[a-z0-9]"
                    maxLength={15}
                    required
                    defaultValue={values.pubId}
                    aria-invalid={Boolean(errors.pubId)}
                    aria-describedby="profile-slug-description"
                    onInput={(event) => {
                      event.currentTarget.value = event.currentTarget.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, "");
                    }}
                  />
                </div>
                <FieldDescription id="profile-slug-description">
                  프로필 주소에 쓰는 이름입니다. 영문 소문자, 숫자, 하이픈
                  5~15자.
                </FieldDescription>
                <FieldError>{errors.pubId}</FieldError>
              </Field>

              <Field
                data-invalid={Boolean(errors.name)}
                className="sm:col-span-2"
              >
                <FieldLabel htmlFor="profile-name">
                  <RequiredLabel>이름</RequiredLabel>
                </FieldLabel>
                <TextField
                  id="profile-name"
                  name="name"
                  defaultValue={values.name}
                  maxLength={50}
                  required
                  aria-invalid={Boolean(errors.name)}
                />
                <FieldError>{errors.name}</FieldError>
              </Field>

              <Field data-invalid={Boolean(errors.birthday)}>
                <FieldLabel htmlFor="profile-birthday">
                  {isStudent ? <RequiredLabel>생일</RequiredLabel> : "생일"}
                </FieldLabel>
                <DateSelect
                  id="profile-birthday"
                  name="birthday"
                  defaultValue={values.birthday}
                  required={isStudent}
                  aria-invalid={Boolean(errors.birthday)}
                />
                <FieldError>{errors.birthday}</FieldError>
              </Field>

              {academicProfile ? (
                <>
                  <Field data-invalid={Boolean(errors.gender)}>
                    <FieldLabel htmlFor="profile-gender">
                      <RequiredLabel>성별</RequiredLabel>
                    </FieldLabel>
                    <NativeSelect
                      id="profile-gender"
                      name="gender"
                      defaultValue={values.gender ?? ""}
                      required
                      aria-invalid={Boolean(errors.gender)}
                      className="w-full"
                    >
                      <NativeSelectOption value="male">남성</NativeSelectOption>
                      <NativeSelectOption value="female">
                        여성
                      </NativeSelectOption>
                    </NativeSelect>
                    <FieldError>{errors.gender}</FieldError>
                  </Field>

                  <Field
                    data-invalid={Boolean(errors.academicTrack)}
                    className="sm:col-span-2"
                  >
                    <FieldLabel htmlFor="profile-track">
                      <RequiredLabel>계열</RequiredLabel>
                    </FieldLabel>
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
                </>
              ) : null}
            </div>
          </details>
        </CardContent>
      </Card>

      {/* Card의 `overflow-hidden` 안에서는 sticky가 안 걸려 저장 줄을 밖으로 뺀다. */}
      <div className="sticky bottom-0 z-10 -mx-3 flex flex-col-reverse gap-2 border-t bg-background/95 px-3 py-3 backdrop-blur-sm sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
        <Link
          to={`/profile/${profile.pub_id}`}
          className={buttonVariants({
            variant: "outline",
            className: "w-full justify-center sm:w-auto",
          })}
        >
          취소
        </Link>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? <Spinner data-icon="inline-start" /> : null}
          저장
        </Button>
      </div>
    </Form>
  );
}
