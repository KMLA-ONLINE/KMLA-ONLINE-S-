import { LinkIcon, LockIcon, UsersIcon } from "lucide-react";
import { Link, useFetcher } from "react-router";

import {
  getGroupIdentityPolicyLabel,
  getGroupJoinPolicyLabel,
  getGroupPostingPolicyLabel,
} from "~/features/groups/model/format";
import type { GroupInvitePreview } from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 초대 링크를 열었을 때 보이는 화면.
 *
 * 그룹 상세(`/groups/:slug`)로 바로 보낼 수 없어서 화면이 따로 있다. 그 로더는 토큰을 읽기도
 * 전에 RLS에 막혀 404를 던진다 — 비공개 그룹의 행은 비멤버에게 존재하지 않기 때문이다.
 *
 * 아이콘과 커버는 보여 주지 않는다. 저장소 정책이 비멤버에게 비공개 그룹의 이미지를 내주지
 * 않고, 미리보기 한 장을 위해 그 정책을 넓히지 않았다.
 */
export function GroupInviteScreen({
  preview,
}: {
  preview: GroupInvitePreview | null;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const pending = fetcher.state !== "idle";

  if (!preview) {
    return (
      <Card className="rounded-none border-x-0 md:rounded-xl md:border">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <LinkIcon aria-hidden="true" className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">쓸 수 없는 초대 링크입니다</p>
            <p className="text-sm leading-6 text-muted-foreground">
              기한이 지났거나 그룹 운영진이 링크를 끊었습니다. 초대한 사람에게
              새 링크를 받아 주세요.
            </p>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/groups" />}
          >
            그룹 목록으로
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader className="border-b">
        <CardTitle>{preview.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-6 text-muted-foreground">
          {preview.description || "아직 그룹 설명이 없습니다."}
        </p>

        <dl className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
          <InfoRow icon={<UsersIcon />} label="멤버">
            {preview.member_count.toLocaleString("ko-KR")}명
          </InfoRow>
          <InfoRow icon={<LockIcon />} label="가입 방식">
            {getGroupJoinPolicyLabel(preview.join_policy)}
          </InfoRow>
          <InfoRow icon={<LinkIcon />} label="활동 방식">
            {getGroupIdentityPolicyLabel(preview.identity_policy)} ·{" "}
            {getGroupPostingPolicyLabel(preview.posting_policy)}
          </InfoRow>
        </dl>

        {preview.already_member ? (
          <>
            <p className="text-sm text-muted-foreground">
              이미 이 그룹의 멤버입니다.
            </p>
            <Button
              nativeButton={false}
              render={<Link to={`/groups/${preview.slug}`} />}
            >
              그룹 열기
            </Button>
          </>
        ) : (
          <fetcher.Form method="post" className="flex flex-col gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              가입하기
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              가입하면 이 그룹의 게시물과 멤버 명부를 볼 수 있습니다.
            </p>
          </fetcher.Form>
        )}

        {fetcher.data?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {fetcher.data.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactElement;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="grid size-5 shrink-0 place-items-center text-muted-foreground [&>svg]:size-4"
      >
        {icon}
      </span>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto font-medium">{children}</dd>
    </div>
  );
}
