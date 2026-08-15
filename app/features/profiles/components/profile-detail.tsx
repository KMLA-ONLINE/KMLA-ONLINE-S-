import { ShieldCheckIcon } from "lucide-react";

import type { AcceptedProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Badge } from "~/shared/ui/badge";
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

export function ProfileDetail({
  profile,
  isOwnProfile,
}: {
  profile: AcceptedProfile;
  isOwnProfile: boolean;
}) {
  const schoolSummary = [
    profile.cohort === null ? null : `${profile.cohort}기`,
    profile.academic_track === null
      ? null
      : TRACK_LABELS[profile.academic_track],
  ].filter((value): value is string => value !== null);

  const facts: ProfileFact[] = [
    {
      label: "구분",
      value: TYPE_LABELS[profile.type],
    },
    {
      label: "기수",
      value: profile.cohort === null ? null : `${profile.cohort}기`,
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
    {
      label: "학번",
      value: profile.student_number,
    },
    {
      label: "반",
      value: profile.class_no === null ? null : `${profile.class_no}반`,
    },
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
  ];

  return (
    <main className="px-4 pb-8 md:px-0">
      <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
        <Card className="gap-0 py-0">
          <div className="h-36 bg-muted sm:h-48" aria-hidden />

          <CardContent className="px-5 pb-6 sm:px-8">
            <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end">
              <div className="w-fit shrink-0 rounded-full border-4 border-background bg-background">
                <UserAvatar
                  src={profile.avatar_path}
                  name={profile.name}
                  className="size-24 sm:size-28"
                />
              </div>

              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold sm:text-3xl">
                    {profile.name}
                  </h1>

                  <Badge variant="secondary">{TYPE_LABELS[profile.type]}</Badge>

                  {isOwnProfile ? (
                    <Badge variant="outline">내 프로필</Badge>
                  ) : null}

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
                  <p className="mt-2 text-sm text-muted-foreground">
                    {schoolSummary.join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>

            {profile.description ? (
              <p className="mt-5 max-w-3xl text-sm leading-6 whitespace-pre-wrap sm:text-base">
                {profile.description}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:gap-6">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>정보</CardTitle>
            </CardHeader>

            <CardContent>
              <dl className="divide-y divide-border/70">
                {facts
                  .filter((fact) => fact.value !== null)
                  .map((fact) => (
                    <div
                      key={fact.label}
                      className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <dt className="text-muted-foreground">{fact.label}</dt>
                      <dd className="min-w-0 font-medium break-words">
                        {fact.href ? (
                          <a href={fact.href} className="hover:underline">
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

          <Card>
            <CardHeader>
              <CardTitle>게시물</CardTitle>
            </CardHeader>

            <CardContent>
              <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  아직 표시할 게시물이 없습니다.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
