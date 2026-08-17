import {
  Building2Icon,
  CakeIcon,
  GraduationCapIcon,
  UsersRoundIcon,
  HouseIcon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  UserRoundIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { ProfileMediaEditor } from "~/features/profiles/components/profile-media-editor";
import type { AcceptedProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { buttonVariants } from "~/shared/ui/button";
import { Card, CardContent } from "~/shared/ui/card";

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
  icon: ReactNode;
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
    profile.type === "teacher" ? "교사" : null,
  ].filter((value): value is string => value !== null);

  const hasCoverImage = Boolean(profile.cover_url?.trim());
  const heroBackground = hasCoverImage ? profile.cover_url : profile.avatar_url;

  const facts: ProfileFact[] = [
    {
      label: "학번",
      value: profile.student_number,
      icon: <GraduationCapIcon aria-hidden />,
    },
    {
      label: "반",
      value: profile.class_no === null ? null : `${profile.class_no}반`,
      icon: <UsersRoundIcon aria-hidden />,
    },
    {
      label: "부서",
      value: profile.department,
      icon: <Building2Icon aria-hidden />,
    },
    {
      label: "기숙사",
      value: profile.dorm_room === null ? null : `${profile.dorm_room}호`,
      icon: <HouseIcon aria-hidden />,
    },
    {
      label: "성별",
      value: profile.gender === null ? null : GENDER_LABELS[profile.gender],
      icon: <UserRoundIcon aria-hidden />,
    },
    {
      label: "생일",
      value:
        profile.birthday === null ? null : formatBirthday(profile.birthday),
      icon: <CakeIcon aria-hidden />,
    },
    {
      label: "전화번호",
      value: profile.phone_number,
      icon: <PhoneIcon aria-hidden />,
      href: profile.phone_number
        ? `tel:${profile.phone_number.replace(/[ -]/g, "")}`
        : undefined,
    },
    {
      label: "이메일",
      value: profile.contact_email,
      icon: <MailIcon aria-hidden />,
      href: profile.contact_email
        ? `mailto:${profile.contact_email}`
        : undefined,
    },
  ];

  const visibleFacts = facts.filter(
    (fact) => fact.value !== null && fact.value.trim() !== "",
  );

  return (
    <main className="px-3 pb-4 md:px-0 md:pb-10">
      <div className="w-full space-y-2 md:space-y-6">
        <section className="-mx-3 overflow-hidden bg-background sm:mx-0 sm:rounded-2xl sm:border">
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
          <div className="bg-background px-3 pb-2.5 sm:px-8 sm:pb-7">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5 sm:gap-y-3">
              {/* avatar */}
              <div className="relative z-10 row-span-2 -mt-9 w-fit shrink-0 rounded-full border-[3px] border-background bg-background shadow-sm sm:row-span-1 sm:-mt-14 sm:border-4">
                <div className="relative">
                  <UserAvatar
                    src={profile.avatar_url}
                    name={profile.name}
                    className="size-[5.5rem] sm:size-32"
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
              <div className="min-w-0 pt-2.5 sm:pt-4">
                <h1 className="min-w-0 truncate text-[1.35rem] leading-tight font-semibold tracking-tight sm:text-3xl">
                  {profile.name}
                </h1>

                {schoolSummary.length > 0 ? (
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground sm:mt-1.5 sm:text-sm">
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
                      "col-span-2 mt-1 h-10 w-full justify-center sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:mt-4 sm:h-auto sm:w-auto sm:self-start sm:py-2",
                  })}
                >
                  <PencilIcon />
                  프로필 편집
                </Link>
              ) : null}
            </div>

            {profile.description ? (
              <p className="mt-3 max-w-3xl text-sm leading-5.5 whitespace-pre-wrap sm:mt-5 sm:text-base sm:leading-6">
                {profile.description}
              </p>
            ) : null}
          </div>
        </section>

        {/* content */}
        <div className="grid gap-2.5 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-4">
          <section className="min-w-0 space-y-1.5 sm:space-y-2">
            <h2 className="px-0.5 text-[17px] font-semibold tracking-tight sm:px-1 sm:text-xl">
              정보
            </h2>

            <Card className="-mx-3 h-fit gap-0 rounded-none border-x-0 py-0 shadow-none sm:mx-0 sm:rounded-xl sm:border sm:shadow-sm">
              <CardContent className="px-3 py-2.5 sm:px-6 sm:py-5">
                <div className="divide-y divide-border/70">
                  {visibleFacts.map((fact) => (
                    <div
                      key={fact.label}
                      className="flex min-w-0 items-center gap-2.5 py-2.5 first:pt-0 last:pb-0 sm:gap-3 sm:py-3"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground sm:size-8 [&_svg]:size-3.5 sm:[&_svg]:size-4">
                        {fact.icon}
                      </span>

                      <div className="min-w-0 text-sm font-medium break-words">
                        <span className="sr-only">{fact.label}: </span>

                        {fact.href ? (
                          <a href={fact.href} className="hover:underline">
                            {fact.value}
                          </a>
                        ) : (
                          fact.value
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="min-w-0 space-y-1.5 sm:space-y-2">
            <h2 className="px-0.5 text-[17px] font-semibold tracking-tight sm:px-1 sm:text-xl">
              게시물
            </h2>

            <Card className="-mx-3 gap-0 rounded-none border-x-0 py-0 shadow-none sm:mx-0 sm:rounded-xl sm:border sm:shadow-sm">
              <CardContent className="flex min-h-24 items-center justify-center px-3 py-6 text-center text-sm text-muted-foreground sm:min-h-56 sm:px-6 sm:py-10">
                아직 게시물이 없습니다.
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </main>
  );
}
