import type { Database } from "~/shared/supabase/database.types";

export type GroupPostReportReason =
  Database["public"]["Enums"]["group_post_report_reason"];

export const GROUP_POST_REPORT_REASON_OPTIONS = [
  {
    value: "abuse",
    label: "욕설·비방·괴롭힘",
  },
  {
    value: "sexual",
    label: "음란하거나 부적절한 콘텐츠",
  },
  {
    value: "privacy",
    label: "개인정보 침해",
  },
  {
    value: "impersonation",
    label: "사칭·허위 정보",
  },
  {
    value: "spam",
    label: "스팸·광고",
  },
  {
    value: "other",
    label: "기타",
  },
] as const satisfies readonly {
  value: GroupPostReportReason;
  label: string;
}[];

export function getGroupPostReportReasonLabel(
  reason: GroupPostReportReason,
): string {
  return (
    GROUP_POST_REPORT_REASON_OPTIONS.find((item) => item.value === reason)
      ?.label ?? reason
  );
}

export function normalizeGroupPostReportDescription(
  value: string,
): string | null {
  const normalized = value.trim();
  return normalized || null;
}

export function validateGroupPostReport(
  reason: GroupPostReportReason | null,
  description: string,
): string | null {
  if (!reason) {
    return "신고 사유를 선택해 주세요.";
  }

  const normalized = normalizeGroupPostReportDescription(description);

  if (reason === "other" && !normalized) {
    return "기타 사유는 설명을 입력해 주세요.";
  }

  if (normalized && Array.from(normalized).length < 5) {
    return "설명은 5자 이상 입력해 주세요.";
  }

  if (normalized && Array.from(normalized).length > 300) {
    return "설명은 300자 이하로 입력해 주세요.";
  }

  return null;
}
