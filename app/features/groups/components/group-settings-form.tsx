import type { GroupDetail } from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

export type SettingsSection = "basic" | "join" | "identity" | "posting";

export function SettingsHidden({
  group,
  omit,
}: {
  group: GroupDetail;
  omit: SettingsSection;
}) {
  return (
    <>
      <input type="hidden" name="intent" value="update-settings" />
      <input type="hidden" name="groupId" value={group.group_id} />
      {omit !== "basic" ? (
        <>
          <input type="hidden" name="name" value={group.name} />
          <input type="hidden" name="description" value={group.description} />
        </>
      ) : null}
      {omit !== "join" ? (
        <input type="hidden" name="joinPolicy" value={group.join_policy} />
      ) : null}
      {omit !== "identity" ? (
        <input
          type="hidden"
          name="identityPolicy"
          value={group.identity_policy}
        />
      ) : null}
      {omit !== "posting" ? (
        <input
          type="hidden"
          name="postingPolicy"
          value={group.posting_policy}
        />
      ) : null}
    </>
  );
}

export function FormActions({
  pending,
  cancel,
}: {
  pending: boolean;
  cancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="ghost" disabled={pending} onClick={cancel}>
        취소
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        저장
      </Button>
    </div>
  );
}

export function ActionStatus({
  data,
}: {
  data: { error?: string; ok?: boolean } | undefined;
}) {
  return data?.error ? (
    <p role="alert" className="mt-3 text-sm text-destructive">
      {data.error}
    </p>
  ) : data?.ok ? (
    <p role="status" className="mt-3 text-sm text-muted-foreground">
      변경 사항을 저장했습니다.
    </p>
  ) : null;
}
