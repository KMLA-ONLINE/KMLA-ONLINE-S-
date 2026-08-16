import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Form, Link, useNavigation, useRevalidator } from "react-router";

import {
  removeProfileMedia,
  replaceProfileMedia,
} from "~/features/profiles/data/media";
import type {
  EditableProfile,
  ProfileEditActionData,
  ProfileEditValues,
  ProfileMediaSlot,
} from "~/features/profiles/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { ImageCropper } from "~/shared/components/image-cropper";
import { UserAvatar } from "~/shared/components/user-avatar";
import { useImageCrop } from "~/shared/hooks/use-image-crop";
import { compressImage } from "~/shared/lib/image/compress";
import { Button, buttonVariants } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Checkbox } from "~/shared/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ProfileEditScreen({
  profile,
  actionData,
}: {
  profile: EditableProfile;
  actionData?: ProfileEditActionData;
}) {
  return (
    <main className="px-4 pb-10 md:px-0">
      <div className="mx-auto max-w-4xl space-y-4 md:space-y-6">
        <ProfileMediaSettings profile={profile} />
        <ProfileEditForm profile={profile} actionData={actionData} />
      </div>
    </main>
  );
}

function ProfileMediaSettings({ profile }: { profile: EditableProfile }) {
  const heroBackground = profile.cover_url ?? profile.avatar_url;

  return (
    <Card className="-mx-4 gap-0 overflow-hidden rounded-none border-x-0 py-0 sm:mx-0 sm:rounded-xl sm:border-x">
      <div className="relative aspect-[3/1] min-h-32 w-full overflow-hidden bg-muted">
        {heroBackground ? (
          <img
            src={heroBackground}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center">
            <ImageIcon
              aria-hidden="true"
              className="size-8 text-muted-foreground/45"
            />
          </div>
        )}
        <div className="absolute inset-0 bg-background/25" aria-hidden />
      </div>

      <CardContent className="px-4 pb-5 sm:px-6">
        <div className="-mt-10 flex items-end gap-3 sm:-mt-12">
          <div className="rounded-full border-4 border-background bg-background">
            <UserAvatar
              src={profile.avatar_url}
              name={profile.name}
              className="size-20 sm:size-24"
            />
          </div>
          <div className="min-w-0 pb-1">
            <p className="truncate font-semibold">{profile.name}</p>
            <p className="text-xs text-muted-foreground">@{profile.pub_id}</p>
          </div>
        </div>

        <div className="mt-5 divide-y rounded-xl border">
          <MediaField profile={profile} slot="avatar" />
          <MediaField profile={profile} slot="cover" />
        </div>
      </CardContent>
    </Card>
  );
}

function MediaField({
  profile,
  slot,
}: {
  profile: EditableProfile;
  slot: ProfileMediaSlot;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const revalidator = useRevalidator();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const isAvatar = slot === "avatar";
  const currentPath = isAvatar ? profile.avatar_path : profile.cover_path;

  const upload = async (cropped: File) => {
    setPending(true);
    setError(null);

    try {
      const file = await compressImage(cropped, isAvatar ? "icon" : "banner");
      await replaceProfileMedia(profile, slot, file);
      await revalidator.revalidate();
    } catch {
      setError("이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const crop = useImageCrop((file) => void upload(file));

  const selectFile = (file: File | undefined) => {
    if (!file) return;

    if (!ACCEPTED_TYPES.has(file.type) || file.size > 30 * 1024 * 1024) {
      setError("JPEG, PNG, WebP 이미지를 30MiB 이하로 선택해 주세요.");
      return;
    }

    setError(null);
    crop.start(file);
  };

  const remove = async () => {
    setPending(true);
    setError(null);

    try {
      await removeProfileMedia(profile, slot);
      await revalidator.revalidate();
    } catch {
      setError("이미지를 제거하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">
          {isAvatar ? "프로필 사진" : "커버 이미지"}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isAvatar
            ? "정사각형으로 자른 뒤 최대 512px로 저장됩니다."
            : "3:1 가로형으로 자른 뒤 긴 변 최대 2400px로 저장됩니다."}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => selectFile(event.target.files?.[0])}
          aria-label={`${isAvatar ? "프로필 사진" : "커버 이미지"} 파일 선택`}
        />

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadIcon aria-hidden="true" />
          )}
          {currentPath ? "변경" : "등록"}
        </Button>

        {currentPath ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2Icon aria-hidden="true" />
            삭제
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive sm:basis-full">
          {error}
        </p>
      ) : null}

      {crop.cropperProps ? (
        <ImageCropper
          {...crop.cropperProps}
          aspect={isAvatar ? 1 : 3}
          maxOutputEdge={isAvatar ? 512 : 2400}
          round={isAvatar}
          title={isAvatar ? "프로필 사진 편집" : "커버 이미지 편집"}
        />
      ) : null}

      {removeOpen ? (
        <ConfirmDialog
          title={`${isAvatar ? "프로필 사진" : "커버 이미지"} 삭제`}
          description={`현재 ${isAvatar ? "프로필 사진" : "커버 이미지"}을 삭제할까요?`}
          confirmLabel="삭제"
          destructive
          pending={pending}
          onCancel={() => setRemoveOpen(false)}
          onConfirm={() => {
            setRemoveOpen(false);
            void remove();
          }}
        />
      ) : null}
    </section>
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
  };
}

function ProfileEditForm({
  profile,
  actionData,
}: {
  profile: EditableProfile;
  actionData?: ProfileEditActionData;
}) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  const values = actionData?.values ?? initialValues(profile);
  const errors = actionData?.errors ?? {};
  const academicProfile =
    profile.type === "student" || profile.type === "alumni";

  return (
    <Card className="-mx-4 rounded-none border-x-0 sm:mx-0 sm:rounded-xl sm:border-x">
      <CardHeader className="border-b">
        <CardTitle>프로필 정보</CardTitle>
      </CardHeader>

      <CardContent>
        <Form method="post" className="space-y-7">
          {errors.form ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {errors.form}
            </div>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
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

            <Field data-invalid={Boolean(errors.birthday)}>
              <FieldLabel htmlFor="profile-birthday">생일</FieldLabel>
              <Input
                id="profile-birthday"
                name="birthday"
                type="date"
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
                defaultValue={values.phoneNumber}
                placeholder="+821012345678"
                aria-invalid={Boolean(errors.phoneNumber)}
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
                defaultValue={values.contactEmail}
                placeholder="name@example.com"
                aria-invalid={Boolean(errors.contactEmail)}
              />
              <FieldError>{errors.contactEmail}</FieldError>
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
                <FieldDescription>
                  개인 게시물 기능이 연결되면 이 설정이 적용됩니다.
                </FieldDescription>
              </div>
            </Field>
          </div>

          {academicProfile ? (
            <section className="space-y-5 border-t pt-6">
              <div>
                <h2 className="font-semibold">학교 정보</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  기수, 학번과 사용자 유형은 직접 변경할 수 없습니다.
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
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

                <Field>
                  <FieldLabel htmlFor="profile-cohort">기수</FieldLabel>
                  <Input
                    id="profile-cohort"
                    value={profile.cohort ?? ""}
                    disabled
                    readOnly
                  />
                </Field>

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
                    <NativeSelectOption value="" disabled>
                      선택
                    </NativeSelectOption>
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
                    <NativeSelectOption value="" disabled>
                      선택
                    </NativeSelectOption>
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
                      <Input
                        id="profile-department"
                        name="department"
                        defaultValue={values.department}
                        maxLength={100}
                        aria-invalid={Boolean(errors.department)}
                      />
                      <FieldError>{errors.department}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(errors.classNo)}>
                      <FieldLabel htmlFor="profile-class">반</FieldLabel>
                      <Input
                        id="profile-class"
                        name="classNo"
                        type="number"
                        min={1}
                        max={20}
                        defaultValue={values.classNo ?? ""}
                        aria-invalid={Boolean(errors.classNo)}
                      />
                      <FieldError>{errors.classNo}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(errors.dormRoom)}>
                      <FieldLabel htmlFor="profile-dorm">기숙사 방</FieldLabel>
                      <Input
                        id="profile-dorm"
                        name="dormRoom"
                        type="number"
                        min={1}
                        max={999}
                        defaultValue={values.dormRoom ?? ""}
                        aria-invalid={Boolean(errors.dormRoom)}
                      />
                      <FieldError>{errors.dormRoom}</FieldError>
                    </Field>
                  </>
                ) : null}
              </div>
            </section>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t pt-6 sm:flex-row sm:justify-end">
            <Link
              to={`/profile/${profile.pub_id}`}
              className={buttonVariants({ variant: "outline" })}
            >
              취소
            </Link>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              저장
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
