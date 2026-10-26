import { formatProfileType } from "~/features/admin/model/format";
import type { RosterMember } from "~/features/admin/model/types";
import { translate, type Locale } from "~/shared/i18n";

export type RosterType = "all" | RosterMember["profile_type"];
export type RosterSort = "name" | "cohort" | "approved";

export interface RosterFilter {
  type: RosterType;
  /** 기수. `null`이면 전체. */
  group: string | null;
  query: string;
  sort: RosterSort;
  /** 이용 정지 중인 사람만. */
  suspendedOnly: boolean;
}

export interface RosterGroup {
  key: string;
  label: string;
  count: number;
}

export const ROSTER_TYPES: RosterType[] = [
  "all",
  "student",
  "alumni",
  "teacher",
];

const collator = new Intl.Collator("ko");

/** 기수가 없는 교직원은 어느 기수에도 묶이지 않는다. */
function groupKey(member: RosterMember): string | null {
  return member.cohort === null ? null : String(member.cohort);
}

export function rosterTypeCounts(
  members: RosterMember[],
): Record<RosterType, number> {
  const counts: Record<RosterType, number> = {
    all: members.length,
    student: 0,
    alumni: 0,
    teacher: 0,
  };
  for (const member of members) counts[member.profile_type] += 1;
  return counts;
}

/** 지금 고른 유형 안의 기수별 인원. 최신 기수부터. */
export function rosterGroups(
  members: RosterMember[],
  type: RosterType,
  locale: Locale = "ko",
): RosterGroup[] {
  const counts = new Map<string, number>();
  for (const member of members) {
    if (type !== "all" && member.profile_type !== type) continue;
    const key = groupKey(member);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([key, count]) => ({
    key,
    label: translate(locale, "{cohort}기", { cohort: key }),
    count,
  })).sort((a, b) => Number(b.key) - Number(a.key));
}

export function filterRoster(
  members: RosterMember[],
  { type, group, query, sort, suspendedOnly }: RosterFilter,
): RosterMember[] {
  const needle = query.trim().toLowerCase();
  const filtered = members.filter(
    (member) =>
      (!suspendedOnly || member.is_suspended) &&
      (type === "all" || member.profile_type === type) &&
      (group === null || groupKey(member) === group) &&
      (!needle ||
        member.name.toLowerCase().includes(needle) ||
        member.pub_id.toLowerCase().includes(needle) ||
        (member.department?.toLowerCase().includes(needle) ?? false)),
  );
  const byName = (a: RosterMember, b: RosterMember) =>
    collator.compare(a.name, b.name) || a.profile_id - b.profile_id;
  return filtered.sort((a, b) => {
    if (sort === "cohort")
      // 최신 기수 먼저, 기수 없는 교직원은 뒤로.
      return (b.cohort ?? -1) - (a.cohort ?? -1) || byName(a, b);
    if (sort === "approved")
      return b.approved_at.localeCompare(a.approved_at) || byName(a, b);
    return byName(a, b);
  });
}

const BOM = String.fromCharCode(0xfeff);

const CSV_HEADER = [
  "이름",
  "공개 ID",
  "유형",
  "기수",
  "부서",
  "앱 관리자",
  "승인 시각",
];

/**
 * 엑셀에서 바로 여는 CSV. 머리글과 유형은 명부 형식에 맞춰 화면 언어와 상관없이 한국어로 둔다. 한글이 깨지지 않게 BOM을 앞에 붙인다.
 * `=`·`+`·`-`·`@`로 시작하는 칸은 엑셀이 수식으로 실행하므로 앞에 `'`를 붙여 글자로 둔다.
 */
export function rosterCsv(members: RosterMember[]): string {
  const rows = members.map((member) => [
    member.name,
    member.pub_id,
    formatProfileType(member.profile_type),
    member.cohort === null ? "" : String(member.cohort),
    member.department ?? "",
    member.is_app_admin ? "예" : "",
    member.approved_at,
  ]);
  return `${BOM}${[CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
