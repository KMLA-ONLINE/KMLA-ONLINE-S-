import { MailIcon, PencilIcon, ShieldCheckIcon } from "lucide-react";
import { Link } from "react-router";

import { ProfileMediaEditor } from "~/features/profiles/components/profile-media-editor";
import type { AcceptedProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Badge } from "~/shared/ui/badge";
import { buttonVariants } from "~/shared/ui/button";
import { Card, CardContent } from "~/shared/ui/card";

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

  // 기수 / 계열은 이름 옆 summary에서 이미 보여주므로
  // 정보 카드에서는 중복해서 표시하지 않는다.
  const facts: ProfileFact[] = [
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
    <main className="px-3 pb-6 md:px-0 md:pb-10">
      <div className="w-full space-y-2.5 md:space-y-6">
        <section className="-mx-3 overflow-hidden border-t bg-background sm:mx-0 sm:rounded-2xl sm:border">
          {/* cover */}
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
                className="absolute top-3 right-3 z-20"
              />
            ) : null}
          </div>

          {/* profile identity */}
          <div className="bg-background px-3 pb-3 sm:px-8 sm:pb-7">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5 sm:gap-y-3">
              {/* avatar */}
              <div className="relative z-10 row-span-2 -mt-10 w-fit shrink-0 rounded-full border-4 border-background bg-background shadow-sm sm:row-span-1 sm:-mt-14">
                <div className="relative">
                  <UserAvatar
                    src={profile.avatar_url}
                    name={profile.name}
                    className="size-24 sm:size-32"
                  />

                  {isOwnProfile ? (
                    <ProfileMediaEditor
                      profile={profile}
                      slot="avatar"
                      className="absolute right-0 bottom-0 z-20"
                    />
                  ) : null}
                </div>
              </div>

              {/* name / summary */}
              <div className="min-w-0 pt-3 sm:pt-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h1 className="min-w-0 text-xl leading-tight font-semibold tracking-tight sm:text-3xl">
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

                {schoolSummary.length > 0 ? (
                  <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                    {schoolSummary.join(" · ")}
                  </p>
                ) : null}
              </div>

              {/* edit button
                  mobile: 이름 오른쪽 영역 아래
                  desktop: 동일 row 우측
                  absolute/translate 사용하지 않음 */}
              {isOwnProfile ? (
                <Link
                  to={`/profile/${profile.pub_id}/edit`}
                  className={buttonVariants({
                    variant: "default",
                    size: "sm",
                    className:
                      "col-span-2 mt-0 h-auto w-full justify-center py-2.5 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:mt-4 sm:w-auto sm:self-start sm:py-2",
                  })}
                >
                  <PencilIcon />
                  프로필 편집
                </Link>
              ) : null}
            </div>

            {profile.description ? (
              <p className="mt-4 max-w-3xl text-sm leading-6 whitespace-pre-wrap sm:mt-5 sm:text-base">
                {profile.description}
              </p>
            ) : null}
          </div>
        </section>

        {/* content */}
        <div className="grid gap-3 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-4">
          <section className="min-w-0 space-y-1.5 sm:space-y-2">
            <h2 className="px-1 text-lg font-semibold tracking-tight sm:text-xl">
              정보
            </h2>

            <Card className="h-fit gap-0 rounded-xl py-0 shadow-none sm:shadow-sm">
              <CardContent className="px-3 py-3 sm:px-6 sm:py-5">
                <dl className="divide-y divide-border/70">
                  {facts
                    .filter((fact) => fact.value !== null)
                    .map((fact) => (
                      <div
                        key={fact.label}
                        className="grid grid-cols-[60px_minmax(0,1fr)] gap-3 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[72px_minmax(0,1fr)] sm:py-3"
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
          </section>

          <section className="min-w-0 space-y-1.5 sm:space-y-2">
            <h2 className="px-1 text-lg font-semibold tracking-tight sm:text-xl">
              게시물
            </h2>

            <Card className="gap-0 rounded-xl py-0 shadow-none sm:shadow-sm">
              <CardContent className="px-3 py-3 sm:px-6 sm:py-5">
                <div className="flex min-h-44 items-center justify-center rounded-lg bg-muted/35 px-4 py-8 text-center sm:min-h-64 sm:px-6 sm:py-12">
                  <div>
                    <p className="font-medium">아직 게시물이 없습니다.</p>

                    <p className="mt-1 text-sm text-muted-foreground">
                      개인 게시물이 추가되면 이곳에 최신순으로 표시됩니다.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </main>
  );
}
