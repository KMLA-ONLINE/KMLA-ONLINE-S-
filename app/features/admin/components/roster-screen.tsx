import { DownloadIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { AdminPersonRow } from "~/features/admin/components/member-list";
import { formatProfileType } from "~/features/admin/model/format";
import {
  filterRoster,
  ROSTER_TYPES,
  rosterCsv,
  rosterGroups,
  rosterTypeCounts,
  type RosterSort,
  type RosterType,
} from "~/features/admin/model/roster";
import type { RosterMember } from "~/features/admin/model/types";
import { getKoreaDateIso } from "~/shared/lib/korea-date";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

/** 한 번에 그리는 줄 수. 졸업생이 쌓이면 수천 명이 되므로 나머지는 `더 보기`로 잇는다. */
const PAGE_SIZE = 200;

const SORT_LABELS: Record<RosterSort, string> = {
  name: "이름순",
  cohort: "최신 기수순",
  approved: "최근 승인순",
};

function typeLabel(type: RosterType): string {
  return type === "all" ? "전체" : formatProfileType(type);
}

function downloadCsv(members: RosterMember[]) {
  const url = URL.createObjectURL(
    new Blob([rosterCsv(members)], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kmla-members-${getKoreaDateIso()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RosterScreen({ members }: { members: RosterMember[] }) {
  const [type, setType] = useState<RosterType>("all");
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RosterSort>("name");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const typeCounts = useMemo(() => rosterTypeCounts(members), [members]);
  const groups = useMemo(() => rosterGroups(members, type), [members, type]);
  const visible = useMemo(
    () => filterRoster(members, { type, group, query, sort }),
    [members, type, group, query, sort],
  );

  const chip = (selected: boolean) =>
    cn(
      "shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors",
      selected
        ? "border-primary bg-primary text-primary-foreground"
        : "hover:bg-muted",
    );

  return (
    <div className="px-0 py-4 md:px-4">
      <Card className="rounded-none md:rounded-xl">
        <CardHeader className="gap-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>승인된 사용자 {members.length}명</CardTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={!visible.length}
              onClick={() => downloadCsv(visible)}
            >
              <DownloadIcon />
              CSV
            </Button>
          </div>

          <div
            role="group"
            aria-label="사용자 유형"
            className="flex gap-2 overflow-x-auto"
          >
            {ROSTER_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                className={chip(type === value)}
                onClick={() => {
                  setType(value);
                  setGroup(null);
                  setLimit(PAGE_SIZE);
                }}
              >
                {typeLabel(value)} {typeCounts[value]}
              </button>
            ))}
          </div>

          {groups.length > 1 ? (
            <div
              role="group"
              aria-label="기수"
              className="flex flex-wrap gap-1.5"
            >
              <button
                type="button"
                aria-pressed={group === null}
                className={chip(group === null)}
                onClick={() => {
                  setGroup(null);
                  setLimit(PAGE_SIZE);
                }}
              >
                전체
              </button>
              {groups.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={group === item.key}
                  className={chip(group === item.key)}
                  onClick={() => {
                    setGroup(group === item.key ? null : item.key);
                    setLimit(PAGE_SIZE);
                  }}
                >
                  {item.label}{" "}
                  <span className="tabular-nums opacity-70">{item.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE_SIZE);
              }}
              placeholder="이름, 공개 ID 또는 부서"
              aria-label="사용자 검색"
              className="[&::-webkit-search-cancel-button]:appearance-none"
            />
            <NativeSelect
              value={sort}
              onChange={(event) => setSort(event.target.value as RosterSort)}
              aria-label="정렬"
              className="shrink-0"
            >
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {visible.length}명
          </p>
        </CardHeader>

        <CardContent className="px-0">
          {visible.length ? (
            <ul>
              {visible.slice(0, limit).map((member) => (
                <AdminPersonRow
                  key={member.profile_id}
                  person={member}
                  status={
                    member.is_app_admin ? (
                      <Badge variant="secondary">앱 관리자</Badge>
                    ) : null
                  }
                  action={null}
                />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              조건에 맞는 사용자가 없습니다.
            </p>
          )}
          {visible.length > limit ? (
            <div className="flex justify-center px-4 pt-4">
              <Button
                variant="outline"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
              >
                더 보기 ({visible.length - limit}명 남음)
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
