import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";

import { GroupJoinRequestsPanel } from "~/features/groups/components/group-join-requests-panel";
import { MemberRoleMenu } from "~/features/groups/components/group-member-role-menu";
import { getGroupMemberRoleLabel } from "~/features/groups/model/format";
import type {
  GroupIdentityPolicy,
  GroupJoinRequest,
  GroupMember,
  GroupMemberPage,
  GroupMemberRole,
} from "~/features/groups/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";

const STAFF_ROLES = new Set<GroupMemberRole>(["owner", "admin", "manager"]);

export function GroupMembersPanel({
  groupId,
  identityPolicy,
  viewerRole,
  initialPage,
  memberCount,
  joinRequests = [],
}: {
  groupId: string;
  identityPolicy: GroupIdentityPolicy;
  viewerRole: GroupMemberRole | null;
  initialPage: GroupMemberPage;
  memberCount: number;
  joinRequests?: GroupJoinRequest[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const serverQuery = searchParams.get("memberQuery") ?? "";
  const [query, setQuery] = useState(serverQuery);
  const [searchError, setSearchError] = useState<string | null>(null);
  const pageFetcher = useFetcher<GroupMemberPage>();
  const [pagination, setPagination] = useState({
    initialPage,
    additionalPages: [] as GroupMemberPage[],
  });
  const processedData = useRef(pageFetcher.data);

  useEffect(() => {
    if (!pageFetcher.data || processedData.current === pageFetcher.data) return;
    processedData.current = pageFetcher.data;
    setPagination((current) => ({
      initialPage,
      additionalPages:
        current.initialPage === initialPage
          ? [...current.additionalPages, pageFetcher.data!]
          : [pageFetcher.data!],
    }));
  }, [initialPage, pageFetcher.data]);

  const pages = [
    initialPage,
    ...(pagination.initialPage === initialPage
      ? pagination.additionalPages
      : []),
  ];
  const members = pages.flatMap((page) => page.members);
  const nextCursor = pages.at(-1)?.nextCursor ?? null;
  const loadMore = () => {
    if (!nextCursor || pageFetcher.state !== "idle") return;
    const next = new URLSearchParams({
      groupId,
      afterRole: nextCursor.role,
      afterJoinedAt: nextCursor.joinedAt,
      afterId: nextCursor.membershipId,
    });
    if (serverQuery) next.set("q", serverQuery);
    void pageFetcher.load(`/groups/member-page?${next}`);
  };
  const sentinelRef = useInfiniteScroll(loadMore, {
    enabled: Boolean(nextCursor),
    pending: pageFetcher.state !== "idle",
  });
  const anonymous = identityPolicy === "always_anonymous";
  const staff = members.filter((member) => STAFF_ROLES.has(member.role));
  const general = members.filter((member) => member.role === "member");
  const canManage = viewerRole === "owner" || viewerRole === "admin";

  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <GroupJoinRequestsPanel
          groupId={groupId}
          requests={joinRequests}
          anonymous={anonymous}
        />
      ) : null}
      <Card className="rounded-none border-0 shadow-none ring-0 md:rounded-xl md:border md:shadow-xs md:ring-1">
        <CardHeader>
          <CardTitle>멤버 {memberCount.toLocaleString("ko-KR")}</CardTitle>
          <form
            className="mt-2"
            onSubmit={(event) => {
              event.preventDefault();
              const normalized = query.trim();
              if (normalized.length === 1) {
                setSearchError("검색어를 2자 이상 입력해 주세요.");
                return;
              }
              setSearchError(null);
              if (normalized === serverQuery) return;
              const next = new URLSearchParams(searchParams);
              if (normalized) next.set("memberQuery", normalized);
              else next.delete("memberQuery");
              next.set("tab", "members");
              setSearchParams(next, { preventScrollReset: true });
            }}
          >
            <div className="relative">
              <label htmlFor="group-member-search" className="sr-only">
                {anonymous ? "기수 검색" : "이름 또는 기수 검색"}
              </label>
              <Input
                id="group-member-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchError(null);
                }}
                className="pr-10"
                placeholder={anonymous ? "기수 검색" : "이름 또는 기수 검색"}
              />
              <Button
                type="submit"
                size="icon-sm"
                variant="ghost"
                className="absolute inset-y-0 right-1 my-auto text-muted-foreground"
                aria-label="멤버 검색"
              >
                <SearchIcon aria-hidden />
              </Button>
            </div>
            {searchError ? (
              <p role="alert" className="mt-1.5 text-xs text-destructive">
                {searchError}
              </p>
            ) : null}
          </form>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <MemberSection
            title="운영진"
            members={staff}
            anonymous={anonymous}
            groupId={groupId}
            viewerRole={viewerRole}
          />
          <MemberSection
            title="일반 멤버"
            members={general}
            anonymous={anonymous}
            groupId={groupId}
            viewerRole={viewerRole}
          />
          {members.length === 0 ? (
            <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              검색 결과가 없습니다.
            </p>
          ) : null}
          <div
            ref={sentinelRef}
            className="flex min-h-8 items-center justify-center"
            aria-live="polite"
          >
            {pageFetcher.state !== "idle" ? (
              <Spinner aria-label="멤버 불러오는 중" />
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MemberSection({
  title,
  members,
  anonymous,
  groupId,
  viewerRole,
}: {
  title: string;
  members: GroupMember[];
  anonymous: boolean;
  groupId: string;
  viewerRole: GroupMemberRole | null;
}) {
  if (members.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="divide-y">
        {members.map((member) => (
          <MemberRow
            key={member.membership_id}
            member={member}
            anonymous={anonymous}
            groupId={groupId}
            viewerRole={viewerRole}
          />
        ))}
      </ul>
    </section>
  );
}

function MemberRow({
  member,
  anonymous,
  groupId,
  viewerRole,
}: {
  member: GroupMember;
  anonymous: boolean;
  groupId: string;
  viewerRole: GroupMemberRole | null;
}) {
  const label = anonymous ? cohortLabel(member.cohort) : member.name;
  const content = (
    <>
      {!anonymous ? (
        <UserAvatar src={member.avatar_path} name={member.name} size="lg" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {!anonymous ? (
          <span className="block text-xs text-muted-foreground">
            {cohortLabel(member.cohort)}
          </span>
        ) : null}
      </span>
      <Badge variant="secondary">{getGroupMemberRoleLabel(member.role)}</Badge>
    </>
  );

  return (
    <li className="flex min-h-16 items-center gap-3 py-2">
      {!anonymous && member.pub_id !== null ? (
        <Link
          to={`/profile/${member.pub_id}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>
      )}
      <MemberRoleMenu
        groupId={groupId}
        member={member}
        viewerRole={viewerRole}
      />
    </li>
  );
}

function cohortLabel(cohort: number | null): string {
  return cohort === null ? "기수 없음" : `${cohort}기`;
}
