import {
  BellIcon,
  FlagIcon,
  LinkIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PinIcon,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import { GroupConfirmDialog } from "~/features/groups/components/group-confirm-dialog";
import { GroupMembershipAction } from "~/features/groups/components/group-membership-action";
import type { GroupDetail } from "~/features/groups/model/types";
import { GroupNotificationDialog } from "~/features/notifications/components/group-notification-dialog";
import { useSearchDialogParam } from "~/shared/hooks/use-search-dialog-param";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Spinner } from "~/shared/ui/spinner";

export function GroupDetailActions({
  group,
  profileId,
  isTeacher,
  canAccessSettings,
  onSelectSettings,
  onSelectReports,
}: {
  group: GroupDetail;
  profileId: number;
  isTeacher: boolean;
  canAccessSettings: boolean;
  onSelectSettings: () => void;
  onSelectReports: () => void;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const pending = fetcher.state !== "idle";
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  // 검색창은 `GroupDetailScreen`이 하나만 그린다. 여기서는 URL만 연다.
  const { openSearch } = useSearchDialogParam();
  const isMember = group.membership_state === "member";
  const canManage =
    group.member_role === "owner" || group.member_role === "admin";
  const canCurate =
    group.member_role === "owner" ||
    group.member_role === "admin" ||
    group.member_role === "manager";
  // 기능 명세 7.12: 공식 그룹은 나갈 수 없고, 소유자는 소유권을 이전해야 나갈 수 있다.
  const canLeave =
    isMember && group.kind !== "official" && group.member_role !== "owner";
  // 기능 명세 7.20: 승인 가입 그룹의 주소는 가입 요청 통로라 소유자·관리자만 나눈다.
  // 초대 전용 그룹은 주소를 받아도 비멤버가 열 수 없어 복사할 이유가 없다.
  const canCopyLink =
    isMember &&
    (group.join_policy === "open" ||
      (group.join_policy === "request" && canManage));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(`/groups/${group.slug}`, window.location.origin).toString(),
      );
      toast.success("그룹 링크를 복사했습니다.");
    } catch {
      toast.error("그룹 링크를 복사하지 못했습니다.");
    }
  };

  return (
    <>
      <div className="flex shrink-0 flex-col items-end gap-1 pt-1">
        <div className="flex flex-wrap justify-end gap-2">
          <GroupMembershipAction
            group={group}
            profileId={profileId}
            isTeacher={isTeacher}
            memberLabel={null}
            joinLabel="그룹 가입"
            hideUnavailable
          />
          {isMember ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="게시물 검색"
              className="hidden md:inline-flex"
              onClick={openSearch}
            >
              <SearchIcon aria-hidden="true" />
            </Button>
          ) : null}
          {isMember || canAccessSettings ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="그룹 옵션"
                    disabled={pending}
                  />
                }
              >
                {pending ? <Spinner /> : <MoreHorizontalIcon />}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-auto whitespace-nowrap"
              >
                {canAccessSettings ? (
                  <DropdownMenuItem onClick={onSelectSettings}>
                    그룹 설정
                  </DropdownMenuItem>
                ) : null}
                {canCurate ? (
                  <>
                    <DropdownMenuItem onClick={onSelectReports}>
                      <FlagIcon />
                      신고
                    </DropdownMenuItem>
                  </>
                ) : null}
                {canCurate && isMember ? <DropdownMenuSeparator /> : null}
                {isMember ? (
                  <>
                    <DropdownMenuGroup>
                      {canCopyLink ? (
                        <DropdownMenuItem onClick={() => void copyLink()}>
                          <LinkIcon />
                          그룹 링크 복사
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem
                        onClick={() => setNotificationOpen(true)}
                      >
                        <BellIcon />
                        알림 설정
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={pending}
                        onClick={() =>
                          void fetcher.submit(
                            {
                              intent: "pin",
                              groupId: group.group_id,
                              profileId: String(profileId),
                              pinned: group.pinned_at ? "false" : "true",
                            },
                            { method: "post" },
                          )
                        }
                      >
                        <PinIcon />
                        {group.pinned_at ? "고정 해제" : "내 그룹에 고정"}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    {canLeave ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={pending}
                          onClick={() => setLeaveOpen(true)}
                        >
                          <LogOutIcon />
                          그룹 탈퇴
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {isTeacher && !isMember && group.join_policy === "request" ? (
          <p className="text-xs text-muted-foreground">
            교사는 초대 링크로만 가입할 수 있습니다.
          </p>
        ) : null}
        {fetcher.data?.error ? (
          <p role="alert" className="text-xs text-destructive">
            {fetcher.data.error}
          </p>
        ) : null}
      </div>

      <GroupNotificationDialog
        groupId={group.group_id}
        groupName={group.name}
        open={notificationOpen}
        onOpenChange={setNotificationOpen}
      />

      <GroupConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={group.name}
        description={
          group.join_policy === "invite_only"
            ? "이 그룹에서 탈퇴할까요? 초대 전용 그룹이라 다시 들어오려면 새 초대를 받아야 합니다."
            : group.join_policy === "request"
              ? "이 그룹에서 탈퇴할까요? 다시 들어오려면 그룹 링크로 가입을 요청하고 승인을 받아야 합니다."
              : "이 그룹에서 탈퇴할까요? 공개 그룹이라 언제든 다시 가입할 수 있습니다."
        }
        confirmLabel="탈퇴"
        confirmVariant="destructive"
        pending={pending}
        onConfirm={() => {
          setLeaveOpen(false);
          void fetcher.submit(
            {
              intent: "leave",
              groupId: group.group_id,
              profileId: String(profileId),
            },
            { method: "post" },
          );
        }}
      />
    </>
  );
}
