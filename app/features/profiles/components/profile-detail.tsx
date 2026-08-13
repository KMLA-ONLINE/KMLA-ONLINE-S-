import { BadgeCheckIcon, LinkIcon, ShieldCheckIcon } from "lucide-react";

import type { AcceptedProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Badge } from "~/shared/ui/badge";
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

export function ProfileDetail({ profile }: { profile: AcceptedProfile }) {
  const details = [
    TYPE_LABELS[profile.type],
    profile.cohort === null ? null : `${profile.cohort}기`,
    profile.academic_track === null
      ? null
      : TRACK_LABELS[profile.academic_track],
  ].filter(Boolean);

  return (
    <main className="px-4 py-6 md:px-0">
      <Card className="mx-auto max-w-2xl">
        <CardContent className="flex flex-col gap-6 p-6 md:p-8">
          <div className="flex items-center gap-4">
            <UserAvatar
              src={profile.avatar_path}
              name={profile.name}
              className="size-16"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold">
                  {profile.name}
                </h1>
                <Badge variant="secondary">
                  <BadgeCheckIcon /> 승인됨
                </Badge>
                {profile.role === "admin" ? (
                  <Badge variant="outline">
                    <ShieldCheckIcon /> 관리자
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {details.join(" · ")}
              </p>
            </div>
          </div>

          {profile.description ? (
            <p className="text-sm leading-6 whitespace-pre-wrap">
              {profile.description}
            </p>
          ) : null}

          <section className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2 font-medium">
              <LinkIcon className="size-4" aria-hidden />
              프로필 링크 확인
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              이 링크는 승인된 KMLA Online 프로필을 가리킵니다.
            </p>
            <p className="mt-3 font-mono text-sm break-all">
              /profile/{profile.pub_id}
            </p>
          </section>
        </CardContent>
      </Card>
    </main>
  );
}
