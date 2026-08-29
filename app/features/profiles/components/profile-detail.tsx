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
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { ProfilePostsPanel, type ProfilePostPage } from "~/features/posts";
import { ProfileMediaEditor } from "~/features/profiles/components/profile-media-editor";
import type { AcceptedProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";
import { Button, buttonVariants } from "~/shared/ui/button";
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

function ProfileDescription({ description }: { description: string }) {
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    if (expanded) return;

    const element = descriptionRef.current;
    if (!element) return;

    const updateTruncation = () => {
      setIsTruncated(element.scrollHeight > element.clientHeight);
    };

    updateTruncation();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateTruncation);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description, expanded]);

  return (
    <div className="mt-3 max-w-3xl basis-full sm:mt-5 md:ml-1">
      <p
        ref={descriptionRef}
        className={cn(
          "text-sm leading-5.5 whitespace-pre-wrap sm:text-base sm:leading-6",
          !expanded && "line-clamp-2",
        )}
      >
        {description}
      </p>
      {isTruncated ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mt-1 h-auto px-0 py-0"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "접기" : "더보기"}
        </Button>
      ) : null}
    </div>
  );
}

export function ProfileDetail({
  profile,
  isOwnProfile,
  viewerName,
  viewerAvatarUrl,
  posts,
}: {
  profile: AcceptedProfile;
  isOwnProfile: boolean;
  /** 지금 보고 있는 사람. 타임라인 당사자와 다를 수 있어 `profile`로 대신하지 못한다. */
  viewerName: string | null;
  viewerAvatarUrl: string | null;
  posts: ProfilePostPage;
}) {
  const schoolSummary = [
    formatCohort(profile),
    profile.academic_track === null
      ? null
      : TRACK_LABELS[profile.academic_track],
    profile.type === "teacher" ? "교사" : null,
  ].filter((value): value is string => value !== null);

  const hasCoverImage = Boolean(profile.cover_url?.trim());

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
          <div
            data-testid="profile-cover"
            className="relative aspect-[3/1] w-full overflow-hidden bg-[#F3F4F7]"
          >
            {hasCoverImage ? (
              <img
                src={profile.cover_url ?? undefined}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 size-full object-cover"
              />
            ) : null}

            {isOwnProfile ? (
              <ProfileMediaEditor
                profile={profile}
                slot="cover"
                className="absolute top-3 right-3 z-20"
              />
            ) : null}
          </div>

          {/* profile identity */}
          <div className="bg-background px-3 pb-2 sm:px-8 sm:pb-7">
            {/* grid가 아니라 줄바꿈하는 flex다. grid에서는 편집 버튼이 아바타가 차지한
                암묵적 row 뒤에 놓여서, 버튼 위 여백이 아바타 높이에 묶여버린다 —
                모바일에서 버튼이 아바타에 딱 붙어 답답해 보이던 이유다. flex에서는
                버튼이 자기 줄로 흘러가므로 위 여백을 버튼이 직접 정한다.
                소개글도 같은 흐름에 태운다 — `basis-full`이라 항상 자기 줄을 얻고,
                모바일에서는 `order`로 편집 버튼보다 위에 놓인다. */}
            <div className="flex flex-wrap items-start gap-x-3 sm:gap-x-7">
              {/* avatar */}
              <div className="relative z-10 -mt-5 w-fit shrink-0 rounded-full border-[3px] border-background bg-background shadow-sm sm:-mt-14 sm:border-4">
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
              <div className="min-w-0 flex-1 pt-2.5 sm:pt-4">
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="min-w-0 truncate text-[1.35rem] leading-tight font-semibold tracking-tight sm:text-3xl">
                    {profile.name}
                  </h1>
                  {profile.role === "admin" ? <Badge>관리자</Badge> : null}
                </div>

                {schoolSummary.length > 0 ? (
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground sm:mt-1.5 sm:text-sm">
                    {schoolSummary.join(" · ")}
                  </p>
                ) : null}
              </div>

              {/* edit button
                  mobile: `order-1`로 소개글 뒤까지 밀고 `basis-full`로 자기 줄을 차지한다
                  desktop: DOM 순서 그대로 이름 오른쪽 같은 줄
                  absolute/translate 사용하지 않음 */}
              {isOwnProfile ? (
                <Link
                  to={`/profile/${profile.pub_id}/edit`}
                  className={buttonVariants({
                    variant: "default",
                    size: "sm",
                    className:
                      "order-1 mt-5 h-10 w-full basis-full justify-center sm:order-none sm:mt-4 sm:h-auto sm:w-auto sm:shrink-0 sm:basis-auto sm:self-start sm:py-2",
                  })}
                >
                  <PencilIcon />
                  프로필 편집
                </Link>
              ) : null}

              {profile.description ? (
                <ProfileDescription description={profile.description} />
              ) : null}
            </div>
          </div>
        </section>

        {/* content */}
        <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
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

          {/* 타임라인은 게시물 카드가 스스로 프레이밍을 들고 있어서(모바일 풀블리드,
              `md:`부터 테두리) 정보 카드처럼 Card로 감싸지 않는다. 감싸면 테두리가 두 겹이
              된다. 좌우 여백을 지우는 구간도 카드가 모서리를 얻는 `md:`에 맞춘다 — `sm:`에서
              풀면 모서리 없는 카드가 안쪽으로 들어와 어중간해진다. */}
          <section className="-mx-3 min-w-0 space-y-1.5 sm:space-y-2 md:mx-0">
            <h2 className="px-3.5 text-[17px] font-semibold tracking-tight sm:text-xl md:px-1">
              게시물
            </h2>

            <ProfilePostsPanel
              timelinePubId={profile.pub_id}
              canWrite={isOwnProfile || profile.allow_timeline_posts}
              isOwnTimeline={isOwnProfile}
              viewerName={viewerName}
              viewerAvatarUrl={viewerAvatarUrl}
              initialPage={posts}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
