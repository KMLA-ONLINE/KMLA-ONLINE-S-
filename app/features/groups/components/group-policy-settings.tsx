import {
  FilePenLineIcon,
  LockKeyholeIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import {
  ActionStatus,
  FormActions,
  SettingsHidden,
  type SettingsSection,
} from "~/features/groups/components/group-settings-form";
import type { GroupDetail } from "~/features/groups/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

type PolicyKind = Exclude<SettingsSection, "basic">;

/**
 * 지금 값에서 `next`로 넘어갈 수 있는지. 서버(`update_group_settings`)가 55000으로 막는 전환을
 * 화면에서도 고를 수 없게 한다 — 저장을 눌러야 실패를 알게 되는 선택지를 남기지 않는다.
 */
function allowsPolicyChange(
  group: GroupDetail,
  kind: PolicyKind,
  next: string,
): boolean {
  // 공개된 그룹은 비공개로 돌아갈 수 없다.
  if (kind === "join" && next === "invite_only") {
    return group.join_policy === "invite_only";
  }
  // 익명을 전제로 모인 그룹은 멤버가 있는 한 익명을 걷을 수 없다. 걷는 순간 멤버 명부의 이름이
  // 한꺼번에 드러난다. 아직 혼자면 지킬 약속을 한 상대가 없으므로 열어 둔다.
  if (kind === "identity" && next !== "always_anonymous") {
    return (
      group.identity_policy !== "always_anonymous" || group.member_count <= 1
    );
  }
  // 공식 그룹은 재학생 전원이 자동 가입하므로 익명으로 바꾸는 순간 위 규칙에 걸려 영영 되돌릴
  // 수 없다. 처음부터 익명으로 만든 공식 그룹은 현재 값이라 이 함수를 거치지 않는다.
  if (kind === "identity" && next === "always_anonymous") {
    return group.kind !== "official";
  }
  return true;
}

const POLICY = {
  join: {
    title: "가입 방식",
    description: "새 멤버가 그룹에 들어오는 방법",
    icon: LockKeyholeIcon,
    name: "joinPolicy",
    options: [
      ["open", "즉시 가입", "누구나 바로 그룹에 가입할 수 있습니다."],
      ["request", "승인 후 가입", "관리자가 가입 요청을 확인하고 승인합니다."],
      ["invite_only", "비공개", "초대받은 사용자만 그룹에 들어올 수 있습니다."],
    ],
  },
  identity: {
    title: "활동 신원",
    description: "게시물과 댓글에서 이름을 표시하는 방식",
    icon: UserRoundCheckIcon,
    name: "identityPolicy",
    options: [
      ["identified", "실명만", "모든 활동에 프로필 이름을 표시합니다."],
      [
        "optional_anonymous",
        "작성할 때 선택",
        "작성자가 실명 또는 익명을 선택할 수 있습니다.",
      ],
      ["always_anonymous", "항상 익명", "모든 활동을 익명으로 표시합니다."],
    ],
  },
  posting: {
    title: "게시물 작성",
    description: "새 게시물을 작성할 수 있는 멤버",
    icon: FilePenLineIcon,
    name: "postingPolicy",
    options: [
      ["members", "모든 멤버", "그룹의 모든 멤버가 게시물을 작성합니다."],
      ["staff", "매니저 이상", "매니저, 관리자와 소유자만 작성합니다."],
    ],
  },
} as const;

export function PolicySettings({ group }: { group: GroupDetail }) {
  const [editing, setEditing] = useState<PolicyKind | null>(null);

  return (
    <Card className="rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader className="border-b">
        <CardTitle>운영 정책</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {(["join", "identity", "posting"] as const).map((kind) => (
            <PolicyRow
              key={kind}
              group={group}
              kind={kind}
              editing={editing === kind}
              onEdit={() => setEditing(kind)}
              onCancel={() => setEditing(null)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PolicyRow({
  group,
  kind,
  editing,
  onEdit,
  onCancel,
}: {
  group: GroupDetail;
  kind: PolicyKind;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const [pendingForm, setPendingForm] = useState<FormData | null>(null);
  const submitted = useRef(false);
  const pending = fetcher.state !== "idle";
  const config = POLICY[kind];
  const Icon = config.icon;
  const current =
    kind === "join"
      ? group.join_policy
      : kind === "identity"
        ? group.identity_policy
        : group.posting_policy;
  const currentOption = config.options.find(([value]) => value === current);
  const options = config.options.filter(
    ([value]) => value === current || allowsPolicyChange(group, kind, value),
  );
  // 고를 것이 지금 값 하나뿐이면 변경 버튼도 두지 않는다. 눌러 봐야 같은 값만 있는 폼이 열린다.
  const changeable = options.length > 1;

  useEffect(() => {
    if (fetcher.state !== "idle" || !submitted.current) return;
    submitted.current = false;
    if (fetcher.data?.ok) queueMicrotask(onCancel);
  }, [fetcher.data, fetcher.state, onCancel]);

  return (
    <section className="px-4 py-2 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">{config.title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {config.description}
              </p>
            </div>
            {!editing && changeable ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`${config.title} 변경`}
                disabled={pending}
                onClick={onEdit}
              >
                변경
              </Button>
            ) : null}
          </div>

          {editing ? (
            <fetcher.Form
              method="post"
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setPendingForm(new FormData(event.currentTarget));
              }}
            >
              <SettingsHidden group={group} omit={kind} />
              <label className="grid gap-2 text-sm font-medium">
                <NativeSelect
                  name={config.name}
                  defaultValue={current}
                  aria-label={config.title}
                  className="w-full [&_[data-slot=native-select]]:h-10 [&_[data-slot=native-select]]:rounded-lg"
                >
                  {options.map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              {kind === "identity" ? (
                <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                  변경한 정책은 앞으로 작성하는 활동부터 적용됩니다. 기존
                  게시물과 댓글의 신원 표시는 바뀌지 않습니다.
                </p>
              ) : null}
              <FormActions pending={pending} cancel={onCancel} />
            </fetcher.Form>
          ) : (
            <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2.5">
              <p className="text-sm font-medium">{currentOption?.[1]}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {currentOption?.[2]}
              </p>
            </div>
          )}
          <ActionStatus data={fetcher.data} />
        </div>
      </div>
      {pendingForm ? (
        <ConfirmDialog
          title={`${config.title} 저장`}
          description={
            kind === "join" &&
            current === "invite_only" &&
            pendingForm.get(config.name) !== "invite_only"
              ? "그룹을 공개하면 다시 비공개로 변경할 수 없습니다. 선택한 가입 방식을 저장할까요?"
              : `선택한 ${config.title} 정책을 저장할까요?`
          }
          confirmLabel="저장"
          pending={pending}
          onCancel={() => setPendingForm(null)}
          onConfirm={() => {
            submitted.current = true;
            void fetcher.submit(pendingForm, { method: "post" });
            setPendingForm(null);
          }}
        />
      ) : null}
    </section>
  );
}
