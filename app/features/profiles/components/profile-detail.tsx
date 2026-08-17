import { MailIcon, PencilIcon, ShieldCheckIcon } from "lucide-react";
import { Link } from "react-router";

import { ProfileMediaEditor } from "~/features/profiles/components/profile-media-editor";
import type { AcceptedProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Badge } from "~/shared/ui/badge";
import { buttonVariants } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";

const TYPE_LABELS: Record<AcceptedProfile["type"], string> = {
  student: "재학생",
  alumni: "졸업생",
  teacher: "교사",
};

const TRACK_LABELS: Record<
  NonNullable<AcceptedProfile["academic_track"]>,
  string
> = {
  domestic: "국내 계열",
  international: "국제 계열",
};

const GENDER_LABELS: Record<NonNullable<AcceptedProfile["gender"]>, string> = {
  male: "남성",
  female: "여성",
};

interface ProfileFact {
  label: string;
  value: string | null;
  href?: string;
}

function formatBirthday(value: string) {
  const [year, month, day] = value.split("-");
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일`;
}

function formatCohort(profile: AcceptedProfile) {
  if (profile.cohort === null) return null;

  const displayedCohort =
    profile.cohort + (profile.is_returning_student ? 0.5 : 0);

  return `${displayedCohort}기`;
}

export function ProfileDetail({
  profile,
  isOwnProfile,
}: {
  profile: AcceptedProfile;
  isOwnProfile: boolean;
}) {
  const schoolSummary = [
    formatCohort(profile),
    profile.academic_track === null
      ? null
      : TRACK_LABELS[profile.academic_track],
  ].filter((value): value is string => value !== null);

  const hasCoverImage = Boolean(profile.cover_url?.trim());
  const heroBackground = hasCoverImage ? profile.cover_url : profile.avatar_url;

  const facts: ProfileFact[] = [
    { label: "구분", value: TYPE_LABELS[profile.type] },
    {
      label: "기수",
      value: formatCohort(profile),
    },
    {
      label: "계열",
      value:
        profile.academic_track === null
          ? null
          : TRACK_LABELS[profile.academic_track],
    },
    {
      label: "성별",
      value: profile.gender === null ? null : GENDER_LABELS[profile.gender],
    },
    { label: "학번", value: profile.student_number },
    {
      label: "반",
      value: profile.class_no === null ? null : `${profile.class_no}반`,
    },
    { label: "부서", value: profile.department },
    {
      label: "기숙사",
      value: profile.dorm_room === null ? null : `${profile.dorm_room}호`,
    },
    {
      label: "생일",
      value:
        profile.birthday === null ? null : formatBirthday(profile.birthday),
    },
    {
      label: "전화번호",
      value: profile.phone_number,
      href: profile.phone_number
        ? `tel:${profile.phone_number.replace(/[ -]/g, "")}`
        : undefined,
    },
    {
      label: "이메일",
      value: profile.contact_email,
      href: profile.contact_email
        ? `mailto:${profile.contact_email}`
        : undefined,
    },
  ];

  return (
    <main className="px-4 pb-8 md:px-0 md:pb-10">
      <div className="w-full space-y-4 md:space-y-6">
        <section className="-mx-4 overflow-hidden border-y bg-background sm:mx-0 sm:rounded-2xl sm:border">
          <div className="relative aspect-[3/1] w-full overflow-hidden bg-muted">
            {heroBackground ? (
              <img
                src={heroBackground}
                alt=""
                aria-hidden="true"
                className={
                  hasCoverImage
                    ? "absolute inset-0 size-full object-cover"
                    : "absolute -inset-8 h-[calc(100%+4rem)] w-[calc(100%+4rem)] scale-110 object-cover blur-2xl"
                }
              />
            ) : null}

            {hasCoverImage ? null : (
              <div className="absolute inset-0 bg-black/10" aria-hidden />
            )}

            {isOwnProfile ? (
              <ProfileMediaEditor
                profile={profile}
                slot="cover"
                className="absolute top-3 right-3 z-20 sm:top-auto sm:bottom-3"
              />
            ) : null}
          </div>

          <div className="relative bg-background px-4 pb-5 sm:px-8 sm:pb-7">
            <div className="-mt-10 flex items-end justify-between gap-3 sm:-mt-14">
              <div className="relative w-fit shrink-0 rounded-full border-4 border-background bg-background shadow-sm">
                <UserAvatar
                  src={profile.avatar_url}
                  name={profile.name}
                  className="size-24 sm:size-32"
                />

                {isOwnProfile ? (
                  <ProfileMediaEditor
                    profile={profile}
                    slot="avatar"
                    className="absolute right-0 bottom-1 z-20"
                  />
                ) : null}
              </div>

              {isOwnProfile ? (
                <Link
                  to={`/profile/${profile.pub_id}/edit`}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "mb-1 shrink-0 bg-background",
                  })}
                >
                  <PencilIcon />
                  프로필 편집
                </Link>
              ) : null}
            </div>

            <div className="mt-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                  {profile.name}
                </h1>

                <Badge variant="secondary">{TYPE_LABELS[profile.type]}</Badge>

                {profile.role === "admin" ? (
                  <Badge variant="outline">
                    <ShieldCheckIcon />
                    관리자
                  </Badge>
                ) : null}
              </div>

              <p className="mt-1 text-sm text-muted-foreground">
                @{profile.pub_id}
              </p>

              {schoolSummary.length > 0 ? (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {schoolSummary.join(" · ")}
                </p>
              ) : null}
            </div>

            {profile.description ? (
              <p className="mt-4 max-w-3xl text-sm leading-6 whitespace-pre-wrap sm:text-base">
                {profile.description}
              </p>
            ) : null}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
          <Card className="h-fit rounded-xl">
            <CardHeader className="pb-3">
              <CardTitle>정보</CardTitle>
            </CardHeader>

            <CardContent>
              <dl className="divide-y divide-border/70">
                {facts
                  .filter((fact) => fact.value !== null)
                  .map((fact) => (
                    <div
                      key={fact.label}
                      className="grid grid-cols-[68px_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[72px_minmax(0,1fr)]"
                    >
                      <dt className="text-sm text-muted-foreground">
                        {fact.label}
                      </dt>

                      <dd className="min-w-0 text-sm font-medium break-words">
                        {fact.href ? (
                          <a
                            href={fact.href}
                            className="inline-flex items-center gap-1.5 hover:underline"
                          >
                            {fact.label === "이메일" ? (
                              <MailIcon className="size-3.5" aria-hidden />
                            ) : null}
                            {fact.value}
                          </a>
                        ) : (
                          fact.value
                        )}
                      </dd>
                    </div>
                  ))}
              </dl>
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <div className="border-b px-5 py-4 sm:px-6">
              <h2 className="text-base font-semibold">게시물</h2>
            </div>

            <CardContent>
              <div className="flex min-h-48 items-center justify-center rounded-xl bg-muted/35 px-5 py-10 text-center sm:min-h-64 sm:px-6 sm:py-12">
                <div>
                  <p className="font-medium">아직 게시물이 없습니다.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    개인 게시물이 추가되면 이곳에 최신순으로 표시됩니다.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
