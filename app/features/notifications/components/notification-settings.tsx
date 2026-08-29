import {
  BellOffIcon,
  BellRingIcon,
  CalendarClockIcon,
  MessageCircleIcon,
  PenLineIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useFetcher, useFetchers } from "react-router";
import { toast } from "sonner";

import { PageHeader } from "~/features/app-shell";
import { GroupNotificationFields } from "~/features/notifications/components/group-notification-dialog";
import {
  disableWebPush,
  enableWebPush,
  getPushSupport,
} from "~/features/notifications/data/push";
import { isDefaultGroupNotificationPreference } from "~/features/notifications/model/notifications";
import type {
  GroupNotificationLevel,
  GroupNotificationPreference,
  NotificationPreferences,
  PushSupport,
} from "~/features/notifications/model/types";
import { Badge } from "~/shared/ui/badge";
import { Spinner } from "~/shared/ui/spinner";
import { Switch } from "~/shared/ui/switch";
import { cn } from "~/shared/lib/utils";

const PREFERENCE_ROWS = [
  [
    "content_push_enabled",
    MessageCircleIcon,
    "댓글 · 답글",
    "내 게시물에 달린 댓글, 내 댓글에 달린 답글",
  ],
  [
    "timeline_push_enabled",
    PenLineIcon,
    "내 타임라인",
    "다른 사람이 내 타임라인에 남긴 게시물",
  ],
  [
    "group_push_enabled",
    UsersIcon,
    "그룹 운영 소식",
    "가입 요청과 승인, 역할과 그룹 정책 변경",
  ],
  [
    "account_push_enabled",
    ShieldCheckIcon,
    "계정 · 권한",
    "가입 승인과 관리 권한 변경",
  ],
  [
    "school_push_enabled",
    CalendarClockIcon,
    "학교 기능",
    "공강 예약 등 학교 부가 기능 소식",
  ],
] as const satisfies readonly (readonly [
  keyof NotificationPreferences,
  LucideIcon,
  string,
  string,
])[];

type PushTone = "on" | "off" | "blocked";
interface SettingsActionResult {
  saved?: boolean;
  error?: string;
}

/**
 * Web Push 상태 하나를 배지 문구·설명·색으로 한 번에 푼다.
 *
 * 상태가 여섯 갈래(미지원, 키 없음, iOS 브라우저, 차단, 꺼짐, 켜짐)라 JSX 안에서 삼항으로
 * 엮으면 어느 가지가 어떤 화면을 그리는지 읽히지 않는다. 분기는 여기 한 곳에만 둔다.
 */
function describePush(
  support: PushSupport,
  pending: boolean,
): { label: string; tone: PushTone; message: string } {
  if (pending) {
    return {
      label: "변경 중",
      tone: "off",
      message: "Web Push 설정을 변경하고 있습니다.",
    };
  }

  switch (support.state) {
    case "ios-browser":
      return {
        label: "설치 필요",
        tone: "off",
        message:
          "iPhone과 iPad에서는 홈 화면에 설치한 앱에서 알림을 켤 수 있습니다.",
      };
    case "unconfigured":
      return {
        label: "사용 불가",
        tone: "off",
        message: "이 환경에는 Web Push 공개 키가 설정되지 않았습니다.",
      };
    case "unsupported":
      return {
        label: "사용 불가",
        tone: "off",
        message: "이 브라우저에서는 Web Push를 사용할 수 없습니다.",
      };
    default:
      if (support.permission === "denied") {
        return {
          label: "차단됨",
          tone: "blocked",
          message:
            "브라우저에서 알림이 차단되어 있습니다. 브라우저 사이트 설정에서 허용해 주세요.",
        };
      }
      return support.subscribed
        ? {
            label: "켜짐",
            tone: "on",
            message: "이 기기에서 새 소식을 받을 수 있습니다.",
          }
        : {
            label: "꺼짐",
            tone: "off",
            message: "중요한 새 소식을 앱을 열지 않아도 받을 수 있습니다.",
          };
  }
}

/**
 * 지금 설정이 실제로 무엇을 뜻하는지 한 문장으로 돌려준다.
 *
 * 규칙을 설명하는 대신 결과를 보여주는 쪽을 택했다. 우선순위 체인(권한 → 기기 → 유형 →
 * 그룹)을 글로 가르치면 읽어야 이해되지만, 결과 문장은 스위치를 만지는 동안 같이 바뀌므로
 * "이거 끄면 어떻게 되지?"를 눌러 보고 확인할 수 있다.
 *
 * 목록을 "받습니다" 앞에 두지 않고 대시 뒤에 두는 것은 조사 때문이다 — 마지막 항목에 따라
 * 을/를이 갈리는데, 항목이 설정에 따라 바뀌므로 문장으로 이으면 반드시 어색해진다.
 */
function summarizeDelivery(
  pushEnabled: boolean,
  preferences: NotificationPreferences,
): { headline: string; detail: string } {
  if (!pushEnabled) {
    return {
      headline: "이 기기로 오는 Push가 없습니다.",
      detail: "받도록 설정한 알림은 앱 알림함에서 확인합니다.",
    };
  }

  const enabled = PREFERENCE_ROWS.filter(([key]) => preferences[key]);

  if (enabled.length === 0) {
    return {
      headline: "이 기기로 운영 조치 Push만 받습니다.",
      detail: "그 밖의 알림은 앱 알림함에서 확인합니다.",
    };
  }

  if (enabled.length === PREFERENCE_ROWS.length) {
    return {
      headline: "이 기기로 받는 알림 — 모든 유형",
      detail: "반응(좋아요 등)은 Push 없이 앱 알림함에만 표시됩니다.",
    };
  }

  return {
    headline: `이 기기로 받는 알림 — ${enabled.map(([, , title]) => title).join(", ")}`,
    detail: "그 밖의 알림은 앱 알림함에서만 확인합니다.",
  };
}

function SettingsSection({
  title,
  scope,
  description,
  footnote,
  children,
}: {
  title: string;
  scope: string;
  description: string;
  footnote?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {/* 어떤 설정이 이 기기에만 적용되고 어떤 것이 계정 전체에 적용되는지는 화면
              어디에도 드러나지 않던 정보다. 섹션마다 한 번씩 붙여 둔다. */}
          <Badge
            variant="outline"
            className="font-normal text-muted-foreground"
          >
            {scope}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>

      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {children}
      </div>

      {footnote ? (
        <p className="px-1 pt-2 text-xs text-muted-foreground">{footnote}</p>
      ) : null}
    </section>
  );
}

function GroupPreferenceRow({
  preference,
  disabled,
}: {
  preference: GroupNotificationPreference;
  disabled: boolean;
}) {
  const fetcher = useFetcher<SettingsActionResult>();
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
  const contentPushEnabled = fetcher.formData
    ? fetcher.formData.get("contentPushEnabled") === "true"
    : preference.contentPushEnabled;

  const save = (
    nextLevel: GroupNotificationLevel,
    nextContentPushEnabled: boolean,
    nextNewPostPushEnabled: boolean,
  ) => {
    void fetcher.submit(
      {
        intent: "group-preferences",
        groupId: preference.groupId,
        level: nextLevel,
        contentPushEnabled: String(nextContentPushEnabled),
        newPostPushEnabled: String(nextNewPostPushEnabled),
      },
      { method: "post" },
    );
  };

  return (
    <div className="px-4 py-3">
      <GroupNotificationFields
        label={
          <p className="min-w-0 truncate text-sm font-medium">
            {preference.groupName}
          </p>
        }
        groupName={preference.groupName}
        level={level}
        contentPushEnabled={contentPushEnabled}
        newPostPushEnabled={newPostPushEnabled}
        pending={disabled || fetcher.state !== "idle"}
        onChange={save}
      />
      {fetcher.data?.error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {fetcher.data.error}
        </p>
      ) : null}
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
  const fetcher = useFetcher<SettingsActionResult>();
  const activeFetchers = useFetchers();

  // 화면에 들어온 순간 "기본값이 아니던" 그룹을 기억한다. 여기서 다시 기본값으로 돌려도
  // 행이 발밑에서 사라지지 않아야 방금 무엇을 바꿨는지 확인할 수 있다.
  const [pinnedGroupIds] = useState(
    () =>
      new Set(
        groupPreferences
          .filter((item) => !isDefaultGroupNotificationPreference(item))
          .map((item) => item.groupId),
      ),
  );

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
    } catch (error) {
      console.error("Failed to update Web Push subscription", error);
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
  const preferencePending = activeFetchers.some(
    (item) =>
      item.state !== "idle" &&
      (item.formData?.get("intent") === "preferences" ||
        item.formData?.get("intent") === "group-preferences"),
  );
  const settingsPending = pushPending || preferencePending;
  const push = describePush(pushSupport, pushPending);
  const summary = summarizeDelivery(pushEnabled, preferences);
  const adjustedGroups = groupPreferences.filter(
    (item) =>
      pinnedGroupIds.has(item.groupId) ||
      !isDefaultGroupNotificationPreference(item),
  );

  return (
    <>
      <PageHeader title="알림 설정" back="/menu/settings" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">알림 설정</h1>

        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-start gap-3 p-4">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                pushEnabled
                  ? "bg-primary/10 text-primary"
                  : push.tone === "blocked"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {pushEnabled ? <BellRingIcon /> : <BellOffIcon />}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">이 기기의 Web Push</h2>
                <Badge
                  variant={
                    push.tone === "on"
                      ? "default"
                      : push.tone === "blocked"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {push.label}
                </Badge>
              </div>
              <p
                className="mt-1 text-sm text-muted-foreground"
                aria-live="polite"
              >
                {push.message}
              </p>
            </div>

            {pushSupport.state === "available" &&
            pushSupport.permission !== "denied" ? (
              <div className="flex min-w-8 items-center justify-end gap-2">
                {pushPending ? (
                  <Spinner aria-label="Web Push 설정 변경 중" />
                ) : null}
                <Switch
                  aria-label="이 기기의 Web Push"
                  checked={pushEnabled}
                  disabled={settingsPending}
                  onCheckedChange={() => void togglePush()}
                />
              </div>
            ) : null}
          </div>

          <div className="border-t bg-muted/30 px-4 py-3">
            <p className="text-sm font-medium">{summary.headline}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {summary.detail}
            </p>
          </div>

          {pushSupport.state === "ios-browser" ? (
            <div className="flex gap-2 border-t bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <SmartphoneIcon className="mt-0.5 size-4 shrink-0" />
              Safari 공유 메뉴에서 ‘홈 화면에 추가’를 선택한 뒤 설치된 앱을 열어
              주세요.
            </div>
          ) : null}
        </section>

        <SettingsSection
          title="유형별 Push"
          scope="모든 기기"
          description="이 기기 Push가 켜져 있을 때 어떤 유형을 보낼지 고릅니다."
          footnote="운영 조치는 유형별 설정과 관계없이 전달됩니다. 가입 승인·차단 Push는 ‘계정 · 권한’ 설정을 따르며, 이메일과 앱 알림함은 계속 전달됩니다."
        >
          {PREFERENCE_ROWS.map(([key, Icon, title, description]) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
                {!preferences[key] ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    앱 알림함에서는 계속 확인할 수 있습니다.
                  </p>
                ) : null}
              </div>
              <Switch
                aria-label={title}
                checked={preferences[key]}
                disabled={settingsPending}
                onCheckedChange={(checked) =>
                  savePreferences({ ...preferences, [key]: checked })
                }
              />
            </div>
          ))}
          {fetcher.data?.error ? (
            <p role="alert" className="px-4 py-3 text-xs text-destructive">
              {fetcher.data.error}
            </p>
          ) : null}
        </SettingsSection>

        <SettingsSection
          title="그룹별 알림"
          scope="모든 기기"
          description="기본값을 바꾼 그룹만 모아 둡니다. 그룹 화면의 ⋯ 메뉴에서 그룹마다 바꿀 수 있습니다."
          footnote="앱 알림함과 Push를 따로 고릅니다. ‘없음’으로 둔 그룹은 Push도 받을 수 없습니다."
        >
          {adjustedGroups.length > 0 ? (
            adjustedGroups.map((preference) => (
              <GroupPreferenceRow
                key={preference.groupId}
                preference={preference}
                disabled={settingsPending}
              />
            ))
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              모든 그룹이 기본 설정입니다.
            </p>
          )}
        </SettingsSection>
      </div>
    </>
  );
}
