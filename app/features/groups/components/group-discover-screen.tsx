import { SearchIcon } from "lucide-react";
import { Form } from "react-router";

import { GroupSummaryCard } from "~/features/groups/components/group-summary-card";
import type { DiscoverGroupItem } from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
import { Checkbox } from "~/shared/ui/checkbox";
import { Field, FieldLabel } from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";

export function GroupDiscoverScreen({
  groups,
  query,
  includeJoined,
  profileId,
}: {
  groups: DiscoverGroupItem[];
  query: string;
  includeJoined: boolean;
  profileId: number;
}) {
  return (
    <div className="flex flex-col gap-7 px-4 py-6 md:px-0 md:py-8">
      <div>
        <p className="text-sm font-medium text-primary">DISCOVER</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          그룹 찾기
        </h1>
        <p className="mt-2 text-muted-foreground">
          이름으로 공개 비공식 그룹을 찾아보세요.
        </p>
      </div>

      <Form method="get" className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon
              aria-hidden
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              defaultValue={query}
              className="pl-9"
              placeholder="그룹 이름 검색"
              aria-label="그룹 이름"
            />
          </div>
          <Button type="submit">검색</Button>
        </div>
        <Field orientation="horizontal" className="mt-3 w-fit">
          <Checkbox
            id="include-joined"
            name="includeJoined"
            value="true"
            defaultChecked={includeJoined}
          />
          <FieldLabel htmlFor="include-joined" className="font-normal">
            가입한 그룹도 표시
          </FieldLabel>
        </Field>
      </Form>

      <div aria-live="polite" className="text-sm text-muted-foreground">
        {query
          ? `“${query}” 검색 결과 ${groups.length}개`
          : `공개 그룹 ${groups.length}개`}
      </div>

      {groups.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <GroupSummaryCard
              key={group.group_id}
              group={group}
              profileId={profileId}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed px-5 py-16 text-center">
          <p className="font-medium">조건에 맞는 그룹이 없습니다.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            검색어를 줄이거나 가입 그룹 표시를 켜 보세요.
          </p>
        </div>
      )}
    </div>
  );
}
