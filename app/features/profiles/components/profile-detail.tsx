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
  /** 있으면 처음에는 이 값을 대신 보여주고, 눌러야 `value`가 드러난다. */
  masked?: string;
}

interface ProfileFactGroup {
  /** 화면에 그리지 않고 접근성 트리에서만 묶음을 구분한다. */
  label: string;
  facts: ProfileFact[];
}

/**
 * 연락처를 한눈에 읽히지 않게 가린다(기능 명세 §12.1). 값이 없다는 뜻으로 읽히면 안 되고
 * 본인 확인 단서는 남아야 하므로, 전화번호는 뒷 네 자리를, 이메일은 도메인을 남긴다.
 *
 * 화면에서 가릴 뿐 `get_accepted_profile`은 두 값을 그대로 내려준다. 노출 범위를 줄이는
 * 장치가 아니라 프로필이 명부처럼 읽히지 않게 하는 표시 규칙이다.
 */
function maskPhoneNumber(value: string) {
  const digitCount = value.replace(/\D/g, "").length;
  let seen = 0;

  return value.replace(/\d/g, (digit) => {
    seen += 1;
    return seen > digitCount - 4 ? digit : "•";
  });
}

function maskEmail(value: string) {
  const at = value.lastIndexOf("@");
  if (at <= 0) return "•••";

  return `${value.slice(0, Math.min(2, at))}•••${value.slice(at)}`;
}

function ProfileFactValue({ fact }: { fact: ProfileFact }) {
  const [revealed, setRevealed] = useState(false);

  if (fact.masked !== undefined && !revealed) {
    return (
      <button
        type="button"
        aria-label={`${fact.label} 보기`}
        onClick={() => setRevealed(true)}
        className="cursor-pointer rounded-sm tracking-wide text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {fact.masked}
      </button>
    );
  }

  if (fact.href) {
    return (
      <a href={fact.href} className="hover:underline">
        {fact.value}
      </a>
    );
  }

  return fact.value;
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
    <div className="mt-3 max-w-3xl min-w-0 basis-full sm:col-span-2 sm:col-start-2 sm:row-start-2 sm:mt-5">
      <p
        ref={descriptionRef}
        className={cn(
          "text-sm leading-5.5 break-words whitespace-pre-wrap sm:text-base sm:leading-6",
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
  // 좁은 화면에서는 정보 카드가 타임라인 위에 통째로 쌓여서 첫 게시물까지 한참 걸린다.
  // 그래서 모바일에서만 첫 묶음을 남기고 접는다 — `sm:`부터는 항상 전부 펼쳐 둔다.
  const [factsExpanded, setFactsExpanded] = useState(false);

  const schoolSummary = [
    formatCohort(profile),
    profile.academic_track === null
      ? null
      : TRACK_LABELS[profile.academic_track],
    profile.type === "teacher" ? "교사" : null,
  ].filter((value): value is string => value !== null);

  const hasCoverImage = Boolean(profile.cover_url?.trim());

  // 성격이 다른 항목을 한 덩어리로 쌓으면 눈이 멈출 지점이 없다. 선이나 소제목 대신
  // 묶음 사이 여백으로만 나누고, 부가 정보는 한 톤 낮춰 위계를 만든다.
  const factGroups: ProfileFactGroup[] = [
    {
      label: "학적 정보",
      facts: [
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
      ],
    },
    {
      label: "연락처",
      facts: [
        {
          label: "전화번호",
          value: profile.phone_number,
          icon: <PhoneIcon aria-hidden />,
          href: profile.phone_number
            ? `tel:${profile.phone_number.replace(/[ -]/g, "")}`
            : undefined,
          masked: profile.phone_number
            ? maskPhoneNumber(profile.phone_number)
            : undefined,
        },
        {
          label: "이메일",
          value: profile.contact_email,
          icon: <MailIcon aria-hidden />,
          href: profile.contact_email
            ? `mailto:${profile.contact_email}`
            : undefined,
          masked: profile.contact_email
            ? maskEmail(profile.contact_email)
            : undefined,
        },
      ],
    },
    {
      label: "기타 정보",
      facts: [
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
      ],
    },
  ];

  const visibleFactGroups = factGroups
    .map((group) => ({
      ...group,
      facts: group.facts.filter(
        (fact) => fact.value !== null && fact.value.trim() !== "",
      ),
    }))
    .filter((group) => group.facts.length > 0);

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
          <div className="bg-background px-3 pb-2 sm:px-8 sm:pt-7 sm:pb-7">
            {/* grid가 아니라 줄바꿈하는 flex다. grid에서는 편집 버튼이 아바타가 차지한
                암묵적 row 뒤에 놓여서, 버튼 위 여백이 아바타 높이에 묶여버린다 —
                모바일에서 버튼이 아바타에 딱 붙어 답답해 보이던 이유다. flex에서는
                버튼이 자기 줄로 흘러가므로 위 여백을 버튼이 직접 정한다. 소개글도 같은
                흐름에 태워 `order`로 편집 버튼보다 위에 놓는다.

                sm:부터는 grid다. 소개글을 이름 칼럼 아래(2열 2행)에 두려면 DOM은 그대로
                두고 배치만 바꿔야 하는데 그건 grid만 할 수 있다. 넓은 화면에서는 아바타가
                커버에 걸치지 않고 카드 안에 온전히 들어오므로 음수 margin도 없다.

                아바타는 여기서 다시 `row-span-2`지만 모바일에서 났던 문제는 재발하지
                않는다. 그때는 버튼이 암묵적 배치로 흘러 아바타가 먹은 row 뒤에 떨어졌던
                것이고, 여기서는 세 항목 모두 열/행을 명시해서 span이 아무것도 밀지 못한다.
                span 덕분에 1행 높이를 아바타가 아니라 이름 블록이 정하고, 그래서 소개글이
                학년·계열 바로 아래에 붙는다. */}
            <div className="flex flex-wrap items-start gap-x-3 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-rows-[auto_1fr] sm:gap-x-7">
              {/* avatar */}
              <div className="relative z-10 -mt-5 w-fit shrink-0 rounded-full border-[3px] border-background bg-background sm:col-start-1 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:border-0">
                <div className="relative">
                  <UserAvatar
                    src={profile.avatar_url}
                    name={profile.name}
                    className="size-[5.5rem] after:hidden sm:size-36 sm:after:block"
                  />

                  {isOwnProfile ? (
                    <ProfileMediaEditor
                      profile={profile}
                      slot="avatar"
                      className="pointer-events-none absolute inset-0 z-20"
                    />
                  ) : null}
                </div>
              </div>

              {/* name / summary */}
              <div className="min-w-0 flex-1 pt-2.5 sm:col-start-2 sm:row-start-1 sm:pt-1">
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
                  desktop: 3열 1행, 이름 오른쪽
                  absolute/translate 사용하지 않음 */}
              {isOwnProfile ? (
                <Link
                  to={`/profile/${profile.pub_id}/edit`}
                  className={buttonVariants({
                    variant: "default",
                    size: "sm",
                    className:
                      "order-1 mt-5 h-10 w-full basis-full justify-center sm:order-none sm:col-start-3 sm:row-start-1 sm:mt-1 sm:h-auto sm:w-auto sm:py-2",
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
              {/* 구분선 없이 여백만으로 나눈다. 묶음 안은 좁게, 묶음 사이는 넓게 둬서
                  선을 그리지 않고도 세 덩어리로 읽히게 한다. */}
              <CardContent className="px-3 py-2.5 sm:px-6 sm:py-5">
                <div className="flex flex-col gap-5 sm:gap-6">
                  {visibleFactGroups.map((group, index) => (
                    <div
                      key={group.label}
                      role="group"
                      aria-label={group.label}
                      className={cn(
                        index > 0 && !factsExpanded && "hidden sm:block",
                      )}
                    >
                      {group.facts.map((fact) => (
                        <div
                          key={fact.label}
                          className="flex min-w-0 items-center gap-2.5 py-1 first:pt-0 last:pb-0 sm:gap-3 sm:py-1.5"
                        >
                          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground sm:size-8 [&_svg]:size-3.5 sm:[&_svg]:size-4">
                            {fact.icon}
                          </span>

                          <div className="min-w-0 text-sm font-medium break-words">
                            <span className="sr-only">{fact.label}: </span>
                            <ProfileFactValue fact={fact} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {visibleFactGroups.length > 1 ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="mt-3 h-auto px-0 py-0 sm:hidden"
                    aria-expanded={factsExpanded}
                    onClick={() => setFactsExpanded((current) => !current)}
                  >
                    {factsExpanded ? "접기" : "정보 더 보기"}
                  </Button>
                ) : null}
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
