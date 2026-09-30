import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { updateGroupNotificationPreferences } from "~/features/notifications/data/mutations";
import { getMyGroupNotificationPreference } from "~/features/notifications/data/queries";
import type {
  GroupNotificationLevel,
  GroupNotificationPreference,
} from "~/features/notifications/model/types";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/shared/ui/select";
import { Spinner } from "~/shared/ui/spinner";
import { Switch } from "~/shared/ui/switch";

/** 라벨은 트리거의 좁은 폭용, 설명은 고르는 순간 "전체"의 범위를 알리는 용. */
const GROUP_LEVELS = [
  ["all", "전체", "새 게시물과 나와 관련된 활동을 모두 받습니다."],
  [
    "direct",
    "직접 관련",
    "내 게시물·댓글·멘션 등 나와 직접 관련된 활동만 받습니다.",
  ],
  ["none", "없음", "이 그룹의 콘텐츠 활동 알림을 받지 않습니다."],
] as const satisfies readonly (readonly [
  GroupNotificationLevel,
  string,
  string,
])[];

/** `Select.Value`는 `items`가 없으면 라벨 대신 값(`direct`)을 그려 한 컨트롤 안에서 언어가 갈린다. */
const GROUP_LEVEL_LABEL: Record<GroupNotificationLevel, string> = {
  all: "전체",
  direct: "직접 관련",
  none: "없음",
};

/**
 * 그룹 하나의 알림함 수준과 Push 설정. 설정 화면 행과 그룹 다이얼로그가 같은 컨트롤을 쓰려고 공유한다. 저장은 부르는 쪽 몫이다.
 */
export function GroupNotificationFields({
  label,
  groupName,
  level,
  contentPushEnabled,
  newPostPushEnabled,
  pending,
  onChange,
}: {
  /** 첫 줄 왼쪽에 놓을 것. 설정 화면은 그룹 이름을, 다이얼로그는 항목 이름을 넘긴다. */
  label: ReactNode;
  groupName: string;
  level: GroupNotificationLevel;
  contentPushEnabled: boolean;
  newPostPushEnabled: boolean;
  pending: boolean;
  onChange: (
    level: GroupNotificationLevel,
    contentPushEnabled: boolean,
    newPostPushEnabled: boolean,
  ) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        {label}
        <Select
          value={level}
          items={GROUP_LEVEL_LABEL}
          disabled={pending}
          onValueChange={(value) => {
            if (value !== "none" && value !== "direct" && value !== "all") {
              return;
            }
            onChange(
              value,
              value === "none" ? false : contentPushEnabled,
              value === "all" ? newPostPushEnabled : false,
            );
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-28"
            aria-label={`${groupName} 알림 수준`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            align="end"
            alignItemWithTrigger={false}
            className="w-auto min-w-72"
          >
            <SelectGroup>
              {GROUP_LEVELS.map(([value, optionLabel, description]) => (
                <SelectItem key={value} value={value}>
                  <span className="flex flex-col gap-0.5 py-0.5">
                    <span className="text-sm font-medium">{optionLabel}</span>
                    <span className="text-xs text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-4 border-t pt-3">
        <div className="min-w-0">
          <p className="text-sm">관련 활동 Push</p>
          <p className="text-xs text-muted-foreground">
            {level === "none"
              ? "앱 알림함을 켜야 사용할 수 있습니다."
              : "내 게시물의 댓글처럼 나와 관련된 활동을 알립니다."}
          </p>
        </div>
        <Switch
          aria-label={`${groupName} 관련 활동 Push`}
          checked={contentPushEnabled}
          disabled={pending || level === "none"}
          onCheckedChange={(checked) =>
            onChange(level, checked, newPostPushEnabled)
          }
        />
      </div>

      {level === "all" ? (
        <div className="flex items-center justify-between gap-4 border-t pt-3">
          <div className="min-w-0">
            <p className="text-sm">새 게시물 Push</p>
            <p className="text-xs text-muted-foreground">
              새 게시물은 기본적으로 알림함에만 표시됩니다.
            </p>
          </div>
          <Switch
            aria-label={`${groupName} 새 게시물 Push`}
            checked={newPostPushEnabled}
            disabled={pending}
            onCheckedChange={(checked) =>
              onChange(level, contentPushEnabled, checked)
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 그룹 화면의 ⋯ 메뉴에서 여는 알림 다이얼로그. 값은 열릴 때만 읽는다(그룹 상세 loader에 얹으면 안 여는 방문도 왕복한다).
 */
export function GroupNotificationDialog({
  groupId,
  groupName,
  open,
  onOpenChange,
}: {
  groupId: string;
  groupName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // 어느 그룹의 값인지를 함께 들고 있으면 로딩 여부를 파생시킬 수 있다. 이펙트 본문에서
  // `setLoading(true)`를 부르면 열자마자 렌더가 한 번 더 도는 데다 lint도 막는다.
  const [loaded, setLoaded] = useState<{
    groupId: string;
    preference: GroupNotificationPreference | null;
  } | null>(null);
  const [pending, setPending] = useState(false);

  const changeOpen = (nextOpen: boolean) => {
    if (pending) return;
    if (!nextOpen) setLoaded(null);
    onOpenChange(nextOpen);
  };

  useEffect(() => {
    if (!open) return;

    let active = true;
    getMyGroupNotificationPreference(groupId)
      .then((preference) => {
        if (active) setLoaded({ groupId, preference });
      })
      .catch((error: unknown) => {
        console.error("Failed to load group notification preference", error);
        if (active) {
          toast.error("알림 설정을 불러오지 못했습니다.");
          setLoaded(null);
          onOpenChange(false);
        }
      });

    return () => {
      active = false;
    };
  }, [groupId, onOpenChange, open]);

  const current = loaded?.groupId === groupId ? loaded : null;
  const loading = current === null;
  const preference = current?.preference ?? null;

  const save = (
    level: GroupNotificationLevel,
    contentPushEnabled: boolean,
    newPostPushEnabled: boolean,
  ) => {
    if (!preference) return;
    const previous = preference;

    setLoaded({
      groupId,
      preference: {
        ...preference,
        level,
        contentPushEnabled,
        newPostPushEnabled,
      },
    });
    setPending(true);
    updateGroupNotificationPreferences(
      groupId,
      level,
      contentPushEnabled,
      newPostPushEnabled,
    )
      .catch((error: unknown) => {
        console.error("Failed to save group notification preference", error);
        toast.error(
          "알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
        setLoaded({ groupId, preference: previous });
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>알림 설정</DialogTitle>
          <DialogDescription>
            {groupName}에서 어떤 활동을 알림으로 받을지 정합니다.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner aria-label="알림 설정 불러오는 중" />
          </div>
        ) : preference ? (
          <>
            <GroupNotificationFields
              label={<p className="text-sm font-medium">앱 알림함</p>}
              groupName={groupName}
              level={preference.level}
              contentPushEnabled={preference.contentPushEnabled}
              newPostPushEnabled={preference.newPostPushEnabled}
              pending={pending}
              onChange={save}
            />
            <p className="text-xs text-muted-foreground">
              가입 승인과 역할 변경, 운영 조치는 이 설정과 관계없이 전달됩니다.
            </p>
          </>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">
            이 그룹의 멤버만 알림 설정을 바꿀 수 있습니다.
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => changeOpen(false)}
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
