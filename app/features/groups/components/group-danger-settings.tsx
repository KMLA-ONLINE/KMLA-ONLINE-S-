import { useState } from "react";
import { useFetcher } from "react-router";

import { GroupConfirmDialog } from "~/features/groups/components/group-confirm-dialog";
import type { GroupDetail } from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Field, FieldLabel } from "~/shared/ui/field";
import { TextField } from "~/shared/ui/text-field";

/** 확인을 위해 그대로 옮겨 적어야 하는 문구. */
function deletionPhrase(name: string): string {
  return `group/${name}`;
}

/**
 * 그룹 삭제.
 *
 * 비공식 그룹은 소유자에게만, 공식 그룹은 앱 관리자에게만 보인다. 공식 그룹은 승인된 재학생이
 * 자동으로 가입하는 학교의 공간이므로, 일반 그룹 운영 권한과 분리된 앱 관리자만 지울 수 있다.
 *
 * 확인은 그룹 이름을 그대로 옮겨 적게 한다. `삭제` 버튼을 한 번 더 누르는 확인은 결국 습관이
 * 되지만, 옮겨 적는 동안에는 어느 그룹을 지우는지 눈으로 확인할 수밖에 없다.
 */
export function DangerSettings({
  group,
  canDeleteOfficial,
}: {
  group: GroupDetail;
  canDeleteOfficial: boolean;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const [open, setOpen] = useState(false);
  const [officialConfirmOpen, setOfficialConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const pending = fetcher.state !== "idle";

  const canDelete =
    group.kind === "official"
      ? canDeleteOfficial
      : group.member_role === "owner";
  if (!canDelete) return null;

  const phrase = deletionPhrase(group.name);

  const close = () => {
    setOpen(false);
    setTyped("");
  };

  function submitDeletion() {
    close();
    setOfficialConfirmOpen(false);
    void fetcher.submit(
      { intent: "delete-group", groupId: group.group_id },
      { method: "post" },
    );
  }

  return (
    <Card className="rounded-none border-x-0 border-destructive/40 md:rounded-xl md:border">
      <CardHeader className="border-b border-destructive/40">
        <CardTitle className="text-destructive">그룹 삭제</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          게시물, 댓글, 첨부 파일과 멤버가 모두 사라집니다. 되돌릴 수 없습니다.
        </p>
        <Button
          type="button"
          variant="destructive"
          className="shrink-0"
          disabled={pending}
          onClick={() => setOpen(true)}
        >
          그룹 삭제
        </Button>
      </CardContent>

      {fetcher.data?.error ? (
        <p role="alert" className="px-6 pb-4 text-sm text-destructive">
          {fetcher.data.error}
        </p>
      ) : null}

      <GroupConfirmDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title={group.name}
        description={`멤버 ${group.member_count}명과 및 그룹의 모든 정보가 사라집니다. 되돌릴 수 없습니다.`}
        details={
          <Field>
            <FieldLabel htmlFor="group-deletion-phrase">
              계속하려면 <code className="font-mono">{phrase}</code>를
              입력하세요
            </FieldLabel>
            <TextField
              id="group-deletion-phrase"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.currentTarget.value)}
            />
          </Field>
        }
        confirmLabel="영구 삭제"
        confirmVariant="destructive"
        confirmDisabled={typed.trim() !== phrase}
        pending={pending}
        onConfirm={() => {
          if (group.kind === "official") {
            setOpen(false);
            setOfficialConfirmOpen(true);
          } else submitDeletion();
        }}
      />
      <GroupConfirmDialog
        open={officialConfirmOpen}
        onOpenChange={(next) => {
          setOfficialConfirmOpen(next);
          if (!next) close();
        }}
        title={`'${group.name}' *공식 그룹*을 삭제할까요?`}
        description="이 작업은 되돌릴 수 없습니다."
        confirmLabel="공식 그룹 삭제"
        confirmVariant="destructive"
        pending={pending}
        onConfirm={submitDeletion}
      />
    </Card>
  );
}
