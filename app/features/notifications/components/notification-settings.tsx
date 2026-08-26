import { BellOffIcon, BellRingIcon, SmartphoneIcon } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import { PageHeader } from "~/features/app-shell";
import {
  disableWebPush,
  enableWebPush,
  getPushSupport,
} from "~/features/notifications/data/push";
import type {
  GroupNotificationLevel,
  GroupNotificationPreference,
  NotificationPreferences,
  PushSupport,
} from "~/features/notifications/model/types";
import { Switch } from "~/shared/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/shared/ui/select";

const PREFERENCE_ROWS = [
  ["content_push_enabled", "댓글 · 답글", "내 콘텐츠와 관련된 새 활동"],
  ["timeline_push_enabled", "타임라인", "내 타임라인의 게시물 활동"],
  ["group_push_enabled", "그룹", "가입, 역할과 그룹 운영 소식"],
  ["account_push_enabled", "계정 · 권한", "승인과 계정 권한 변경"],
  ["school_push_enabled", "학교 기능", "예약과 학교 기능 소식"],
] as const satisfies readonly (readonly [
  keyof NotificationPreferences,
  string,
  string,
])[];

const GROUP_LEVEL_LABEL: Record<GroupNotificationLevel, string> = {
  none: "없음",
  direct: "직접 관련",
  all: "전체",
};

function GroupPreferenceRow({
  preference,
}: {
  preference: GroupNotificationPreference;
}) {
  const fetcher = useFetcher();
  const submittedLevel = fetcher.formData?.get("level");
  const level =
    submittedLevel === "none" ||
    submittedLevel === "direct" ||
    submittedLevel === "all"
      ? submittedLevel
      : preference.level;
  const newPostPushEnabled = fetcher.formData
    ? fetcher.formData.get("newPostPushEnabled") === "true"
    : preference.newPostPushEnabled;
  const pending = fetcher.state !== "idle";

  const save = (
    nextLevel: GroupNotificationLevel,
    nextNewPostPushEnabled: boolean,
  ) => {
    void fetcher.submit(
      {
        intent: "group-preferences",
        groupId: preference.groupId,
        level: nextLevel,
        newPostPushEnabled: String(nextNewPostPushEnabled),
      },
      { method: "post" },
    );
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 truncate text-sm font-medium">
          {preference.groupName}
        </p>
        <Select
          value={level}
          disabled={pending}
          onValueChange={(value) => {
            if (value !== "none" && value !== "direct" && value !== "all") {
              return;
            }
            save(value, value === "all" ? newPostPushEnabled : false);
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={`${preference.groupName} 알림 수준`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {Object.entries(GROUP_LEVEL_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm">새 게시물 Push</p>
          <p className="text-xs text-muted-foreground">
            전체 알림을 선택한 그룹에서만 사용할 수 있습니다.
          </p>
        </div>
        <Switch
          aria-label={`${preference.groupName} 새 게시물 Push`}
          checked={level === "all" && newPostPushEnabled}
          disabled={pending || level !== "all"}
          onCheckedChange={(checked) => save(level, checked)}
        />
      </div>
    </div>
  );
}

export function NotificationSettings({
  initialPreferences,
  initialPushSupport,
  groupPreferences,
}: {
  initialPreferences: NotificationPreferences;
  initialPushSupport: PushSupport;
  groupPreferences: GroupNotificationPreference[];
}) {
  const [pushState, setPushState] = useState({
    source: initialPushSupport,
    value: initialPushSupport,
  });
  const [pushPending, setPushPending] = useState(false);
  const fetcher = useFetcher();

  let currentPushState = pushState;
  if (currentPushState.source !== initialPushSupport) {
    currentPushState = {
      source: initialPushSupport,
      value: initialPushSupport,
    };
    setPushState(currentPushState);
  }
  const pushSupport = currentPushState.value;
  const preferences = fetcher.formData
    ? {
        account_push_enabled:
          fetcher.formData.get("account_push_enabled") === "true",
        content_push_enabled:
          fetcher.formData.get("content_push_enabled") === "true",
        group_push_enabled:
          fetcher.formData.get("group_push_enabled") === "true",
        school_push_enabled:
          fetcher.formData.get("school_push_enabled") === "true",
        timeline_push_enabled:
          fetcher.formData.get("timeline_push_enabled") === "true",
      }
    : initialPreferences;

  const savePreferences = (next: NotificationPreferences) => {
    void fetcher.submit(
      {
        intent: "preferences",
        ...Object.fromEntries(
          Object.entries(next).map(([key, value]) => [key, String(value)]),
        ),
      },
      { method: "post" },
    );
  };

  const togglePush = async () => {
    setPushPending(true);
    try {
      if (pushSupport.state === "available" && pushSupport.subscribed) {
        await disableWebPush();
        setPushState({
          source: initialPushSupport,
          value: { ...pushSupport, subscribed: false },
        });
      } else {
        setPushState({
          source: initialPushSupport,
          value: await enableWebPush(),
        });
      }
    } catch {
      toast.error(
        "알림 설정을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
      setPushState({
        source: initialPushSupport,
        value: await getPushSupport(),
      });
    } finally {
      setPushPending(false);
    }
  };

  const pushEnabled =
    pushSupport.state === "available" && pushSupport.subscribed;

  return (
    <>
      <PageHeader title="알림 설정" back="/menu" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">알림 설정</h1>

        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-start gap-3 p-4">
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              {pushEnabled ? <BellRingIcon /> : <BellOffIcon />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">이 기기의 Web Push</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pushSupport.state === "ios-browser"
                  ? "iPhone과 iPad에서는 홈 화면에 설치한 앱에서 알림을 켤 수 있습니다."
                  : pushSupport.state === "unsupported"
                    ? "이 브라우저에서는 Web Push를 사용할 수 없습니다."
                    : pushSupport.permission === "denied"
                      ? "브라우저에서 알림이 차단되어 있습니다. 브라우저 사이트 설정에서 허용해 주세요."
                      : pushEnabled
                        ? "이 기기에서 새 소식을 받을 수 있습니다."
                        : "중요한 새 소식을 앱을 열지 않아도 받을 수 있습니다."}
              </p>
            </div>
            {pushSupport.state === "available" &&
            pushSupport.permission !== "denied" ? (
              <Switch
                aria-label="이 기기의 Web Push"
                checked={pushEnabled}
                disabled={pushPending}
                onCheckedChange={() => void togglePush()}
              />
            ) : null}
          </div>
          {pushSupport.state === "ios-browser" ? (
            <div className="flex gap-2 border-t bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <SmartphoneIcon className="mt-0.5 size-4 shrink-0" />
              Safari 공유 메뉴에서 ‘홈 화면에 추가’를 선택한 뒤 설치된 앱을 열어
              주세요.
            </div>
          ) : null}
        </section>

        <section>
          <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground">
            유형별 Web Push
          </h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {PREFERENCE_ROWS.map(([key, title, description]) => (
              <div key={key} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch
                  aria-label={title}
                  checked={preferences[key]}
                  disabled={fetcher.state !== "idle"}
                  onCheckedChange={(checked) =>
                    savePreferences({ ...preferences, [key]: checked })
                  }
                />
              </div>
            ))}
          </div>
          <p className="px-1 pt-2 text-xs text-muted-foreground">
            운영 조치는 이 기기의 Web Push가 켜져 있는 동안 항상 전달됩니다.
            반응 알림은 앱 안에서만 표시됩니다.
          </p>
        </section>

        {groupPreferences.length > 0 ? (
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground">
              그룹별 알림
            </h2>
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {groupPreferences.map((preference) => (
                <GroupPreferenceRow
                  key={preference.groupId}
                  preference={preference}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
