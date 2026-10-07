import { TriangleAlertIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Form,
  Link,
  useBeforeUnload,
  useBlocker,
  useNavigation,
  useRevalidator,
} from "react-router";

import { PageHeader } from "~/features/app-shell";
import { ProfileMediaEditor } from "~/features/profiles/components/profile-media-editor";
import type {
  EditableProfile,
  ProfileEditActionData,
  ProfileEditValues,
} from "~/features/profiles/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button, buttonVariants } from "~/shared/ui/button";
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
import { Switch } from "~/shared/ui/switch";
import { TextField } from "~/shared/ui/text-field";
import { Textarea } from "~/shared/ui/textarea";

const FORM_ID = "profile-edit-form";
const DESCRIPTION_MAX = 500;

export function ProfileEditScreen({
  profile,
  departments,
  actionData,
}: {
  profile: EditableProfile;
  departments: string[];
  actionData?: ProfileEditActionData;
}) {
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const saving = navigation.state !== "idle" && navigation.formMethod != null;
  const values = actionData?.values ?? initialValues(profile);
  const errors = actionData?.errors ?? {};
  const isStudent = profile.type === "student";
  const academicProfile = isStudent || profile.type === "alumni";

  // 거절당해 돌아온 화면은 사용자가 고친 값을 그대로 들고 있다.
  const [dirty, setDirty] = useState(Boolean(actionData));
  const [pubIdDraft, setPubIdDraft] = useState(values.pubId);
  const [descriptionLength, setDescriptionLength] = useState(
    values.description.length,
  );
  // 저장이 성공하면 action이 프로필로 보낸다. 그 이동을 나가기 확인이 막으면 안 된다.
  const submittedRef = useRef(false);

  useEffect(() => {
    submittedRef.current = false;
  }, [actionData]);

  const markDirty = () => setDirty(true);

  /**
   * 사진은 폼과 따로 바로 저장된다. 새로고침이 모든 캐시를 가장 확실히 비우지만, 고치던 값이 있으면
   * 그것까지 날아가므로 이 화면의 로더만 다시 읽는다. 머리말 아바타는 폼을 저장할 때 따라 갱신된다.
   */
  const onMediaSaved = async () => {
    if (!dirty) {
      window.location.reload();
      return;
    }

    await revalidator.revalidate();
  };

  const saveButton = (size?: "sm") => (
    <Button
      type="submit"
      form={FORM_ID}
      size={size}
      disabled={!dirty || saving}
    >
      {saving ? <Spinner data-icon="inline-start" /> : null}
      저장
    </Button>
  );

  return (
    <>
      <PageHeader
        title="프로필 편집"
        back={`/profile/${profile.pub_id}`}
        actions={saveButton("sm")}
      />

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 pb-10 md:pt-2">
        <div className="hidden items-center gap-2 md:flex">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold">프로필 편집</h1>
          <Link
            to={`/profile/${profile.pub_id}`}
            className={buttonVariants({ variant: "outline" })}
          >
            취소
          </Link>
          {saveButton()}
        </div>

        <ProfileMediaHeader profile={profile} onSaved={onMediaSaved} />

        <Form
          id={FORM_ID}
          method="post"
          onChange={markDirty}
          onSubmit={() => {
            submittedRef.current = true;
          }}
          className="flex flex-col gap-6 px-4 md:px-0"
        >
          {errors.form ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {errors.form}
            </div>
          ) : null}

          <Section title="기본 정보">
            <Field data-invalid={Boolean(errors.name)}>
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

            <Field data-invalid={Boolean(errors.description)}>
              <div className="flex items-baseline justify-between gap-2">
                <FieldLabel htmlFor="profile-description">소개</FieldLabel>
                <span
                  aria-hidden="true"
                  className="text-xs text-muted-foreground tabular-nums"
                >
                  {descriptionLength}/{DESCRIPTION_MAX}
                </span>
              </div>
              <Textarea
                id="profile-description"
                name="description"
                defaultValue={values.description}
                maxLength={DESCRIPTION_MAX}
                rows={4}
                placeholder="나를 소개하는 한마디"
                className="resize-y"
                aria-invalid={Boolean(errors.description)}
                onInput={(event) =>
                  setDescriptionLength(event.currentTarget.value.length)
                }
              />
              <FieldError>{errors.description}</FieldError>
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
          </Section>

          {academicProfile ? (
            <Section title="학적">
              <div className="grid grid-cols-2 gap-4">
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
                    <NativeSelectOption value="female">여성</NativeSelectOption>
                  </NativeSelect>
                  <FieldError>{errors.gender}</FieldError>
                </Field>

                <Field data-invalid={Boolean(errors.academicTrack)}>
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
                        onInput={(event) =>
                          clampDigits(event.currentTarget, 2, 10)
                        }
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
                        onInput={(event) =>
                          clampDigits(event.currentTarget, 4, 1008)
                        }
                      />
                      <FieldError>{errors.dormRoom}</FieldError>
                    </Field>

                    <Field
                      data-invalid={Boolean(errors.department)}
                      className="col-span-2"
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
                  </>
                ) : null}
              </div>

              {isStudent ? (
                <SwitchRow
                  id="profile-returning"
                  name="isReturningStudent"
                  label="복학생"
                  description="복학 여부에 따라 기수 표시와 제공되는 기능이 달라집니다."
                  defaultChecked={values.isReturningStudent}
                  onCheckedChange={markDirty}
                />
              ) : null}
            </Section>
          ) : null}

          <Section title="연락처">
            <Field data-invalid={Boolean(errors.phoneNumber)}>
              <FieldLabel htmlFor="profile-phone">전화번호</FieldLabel>
              <Input
                id="profile-phone"
                name="phoneNumber"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                pattern="\+?[0-9 \-]{8,20}"
                defaultValue={values.phoneNumber}
                placeholder="010-1234-5678"
                aria-invalid={Boolean(errors.phoneNumber)}
                onInput={(event) => formatPhoneNumber(event.currentTarget)}
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
                autoComplete="email"
                maxLength={254}
                defaultValue={values.contactEmail}
                placeholder="name@example.com"
                aria-invalid={Boolean(errors.contactEmail)}
              />
              <FieldError>{errors.contactEmail}</FieldError>
            </Field>
          </Section>

          <Section title="공개 설정">
            <SwitchRow
              id="profile-timeline-posts"
              name="allowTimelinePosts"
              label="내 타임라인에 다른 사람의 글 허용"
              description="끄면 다른 사람에게 내 타임라인의 글쓰기 버튼이 보이지 않습니다."
              defaultChecked={values.allowTimelinePosts}
              onCheckedChange={markDirty}
            />
          </Section>

          <Section title="프로필 주소">
            <Field data-invalid={Boolean(errors.pubId)}>
              <FieldLabel htmlFor="profile-slug">
                <RequiredLabel>slug</RequiredLabel>
              </FieldLabel>
              <div className="flex items-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive">
                <span
                  aria-hidden="true"
                  className="shrink-0 pl-2.5 text-sm text-muted-foreground"
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
                  aria-describedby="profile-slug-description profile-slug-warning"
                  className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
                  onInput={(event) => {
                    const next = event.currentTarget.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "");
                    event.currentTarget.value = next;
                    setPubIdDraft(next);
                  }}
                />
              </div>
              <FieldDescription id="profile-slug-description">
                영문 소문자, 숫자, 하이픈 5~15자.
              </FieldDescription>
              <FieldError>{errors.pubId}</FieldError>

              {/* §12.2: 바꾸면 이전 주소로 공유한 링크가 끊긴다는 사실을 저장 전에 알린다. */}
              <div
                id="profile-slug-warning"
                aria-live="polite"
                className="empty:hidden"
              >
                {pubIdDraft !== profile.pub_id ? (
                  <span className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                    <TriangleAlertIcon
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    저장하면 프로필 주소가 바로 바뀌고, /profile/
                    {profile.pub_id} 로 공유된 링크는 더 이상 열리지 않습니다.
                  </span>
                ) : null}
              </div>
            </Field>
          </Section>
        </Form>
      </main>

      <LeaveGuard
        when={({ currentLocation, nextLocation }) =>
          dirty &&
          !submittedRef.current &&
          currentLocation.pathname !== nextLocation.pathname
        }
        enabled={dirty}
      />
    </>
  );
}

/** 상세 화면과 같은 모양의 커버·아바타. 여기서 바꾸면 바로 저장된다(§12.3). */
function ProfileMediaHeader({
  profile,
  onSaved,
}: {
  profile: EditableProfile;
  onSaved: () => Promise<void>;
}) {
  return (
    <section aria-label="프로필 사진" className="md:overflow-hidden">
      <div className="relative aspect-[3/1] bg-muted md:rounded-xl">
        {profile.cover_url ? (
          <img
            src={profile.cover_url}
            alt=""
            crossOrigin="anonymous"
            className="size-full object-cover md:rounded-xl"
          />
        ) : null}
        <ProfileMediaEditor
          profile={profile}
          slot="cover"
          onSaved={onSaved}
          className="absolute top-3 right-3 z-20"
        />
      </div>

      <div className="relative z-10 -mt-10 ml-4 w-fit rounded-full border-4 border-background bg-background sm:-mt-14 sm:ml-6">
        <div className="relative">
          <UserAvatar
            src={profile.avatar_url}
            name={profile.name}
            className="size-20 sm:size-28"
          />
          <ProfileMediaEditor
            profile={profile}
            slot="avatar"
            onSaved={onSaved}
            className="pointer-events-none absolute inset-0 z-20"
          />
        </div>
      </div>
    </section>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 px-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-5 rounded-xl border bg-card p-4">
        {children}
      </div>
    </section>
  );
}

function SwitchRow({
  id,
  name,
  label,
  description,
  defaultChecked,
  onCheckedChange,
}: {
  id: string;
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <Field orientation="horizontal" className="items-start justify-between">
      <div className="min-w-0">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription id={`${id}-description`} className="mt-1">
          {description}
        </FieldDescription>
      </div>
      <Switch
        id={id}
        name={name}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-description`}
        className="mt-0.5"
      />
    </Field>
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

/** 고친 값을 두고 다른 화면으로 나가려 하면 확인을 받는다. */
function LeaveGuard({
  when,
  enabled,
}: {
  when: Parameters<typeof useBlocker>[0];
  enabled: boolean;
}) {
  const blocker = useBlocker(when);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (enabled) event.preventDefault();
      },
      [enabled],
    ),
  );

  if (blocker.state !== "blocked") return null;

  return (
    <ConfirmDialog
      title="저장하지 않은 변경 사항"
      description="수정한 내용이 저장되지 않았습니다. 저장하지 않고 나갈까요?"
      confirmLabel="나가기"
      destructive
      onCancel={() => blocker.reset()}
      onConfirm={() => blocker.proceed()}
    />
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

/** 숫자만 남기고 `max`를 넘으면 `max`로 맞춘다. 0 하나는 지운다. */
function clampDigits(input: HTMLInputElement, length: number, max: number) {
  let value = input.value.replace(/\D/g, "").slice(0, length);

  if (value === "0") value = "";
  if (Number(value) > max) value = String(max);

  input.value = value;
}

/** 국내 번호는 하이픈을 넣어 주고, `+`로 시작하는 해외 번호는 형식을 짐작하지 않고 허용 문자만 남긴다. */
function formatPhoneNumber(input: HTMLInputElement) {
  if (input.value.startsWith("+")) {
    input.value = `+${input.value.slice(1).replace(/[^0-9 -]/g, "")}`;
    return;
  }

  const digits = input.value.replace(/\D/g, "").slice(0, 11);
  let value = digits;

  if (digits.length > 3) {
    value = `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  if (digits.length > 7) {
    value = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  input.value = value;
}
