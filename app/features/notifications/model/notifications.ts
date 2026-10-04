import type {
  GroupNotificationLevel,
  GroupNotificationGroupKind,
  GroupNotificationPreference,
  NotificationCursor,
  NotificationItem,
} from "~/features/notifications/model/types";
// 배럴은 화면 컴포넌트와 Markdown 파서를 끌고 온다. 의존성 없는 두 모듈만 가져온다.
import { mentionTokenPattern } from "~/features/posts/model/mentions";
import { reactionLabel } from "~/features/posts/model/reactions";

export const NOTIFICATION_PAGE_SIZE = 20;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function groupNotifications(
  items: NotificationItem[],
  now = new Date(),
) {
  const sixHourThreshold = now.getTime() - SIX_HOURS_MS;
  const dayThreshold = now.getTime() - DAY_MS;
  const recentSixHours: NotificationItem[] = [];
  const recentDay: NotificationItem[] = [];
  const older: NotificationItem[] = [];

  for (const item of items) {
    const lastActivityAt = new Date(item.last_activity_at).getTime();
    if (lastActivityAt > sixHourThreshold) {
      recentSixHours.push(item);
    } else if (lastActivityAt > dayThreshold) {
      recentDay.push(item);
    } else {
      older.push(item);
    }
  }

  return { recentSixHours, recentDay, older };
}

/**
 * 새로 가입할 때 서버가 넣어 주는 기본 알림 수준(기술 설계 §3.3). 공식 그룹은 전체 소식을
 * 받고 비공식 그룹은 나와 직접 관련된 활동만 받는다.
 */
export function getDefaultGroupNotificationLevel(
  kind: GroupNotificationGroupKind,
): GroupNotificationLevel {
  return kind === "official" ? "all" : "direct";
}

/**
 * 손대지 않은 그룹인지. 알림 설정 화면은 이 값이 `false`인 그룹만 나열한다 — 가입한 그룹을
 * 전부 늘어놓으면 목록이 길기만 하고, 정작 사용자가 바꾼 그룹이 그 안에 묻힌다.
 */
export function isDefaultGroupNotificationPreference(
  preference: GroupNotificationPreference,
): boolean {
  return (
    preference.level ===
      getDefaultGroupNotificationLevel(preference.groupKind) &&
    preference.contentPushEnabled &&
    !preference.newPostPushEnabled
  );
}

/**
 * 서버가 본문을 200자에서 자르면 멘션 토큰이 `[@김철`처럼 중간에 끊길 수 있다. 온전한 토큰을
 * 먼저 푼 뒤에도 끝에 남은 토큰 조각은 이것으로 걷어 낸다.
 */
const TRUNCATED_MENTION_TAIL =
  /\[@[^\]\n]*(?:\](?:\((?:m(?::[0-9]{0,2})?)?)?)?$/;

/**
 * 알림 한 행의 본문 문장(기능 명세 §14.3).
 *
 * 댓글·답글 알림은 댓글 내용만 보여준다. 누가 썼는지는 윗줄이 이미 말한다. 댓글은 평문이라
 * 멘션 토큰만 `@이름`으로 풀고 줄바꿈을 공백으로 접는다. 본문이 없으면(사진만 있는 댓글,
 * 삭제되었거나 더는 읽을 수 없는 게시물) 저장된 `title`로 돌아간다.
 */
export function getNotificationMessage(
  item: Pick<
    NotificationItem,
    "kind" | "title" | "comment_excerpt" | "reaction"
  >,
): string {
  switch (item.kind) {
    case "post_commented":
    case "comment_replied": {
      const text = item.comment_excerpt
        ?.replace(mentionTokenPattern(), "@$1")
        .replace(TRUNCATED_MENTION_TAIL, "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text;
      return item.title;
    }
    case "post_reacted":
    case "comment_reacted": {
      const target = item.kind === "post_reacted" ? "게시물" : "댓글";
      return item.reaction
        ? `${target}에 ‘${reactionLabel(item.reaction)}’ 반응을 남겼습니다.`
        : `${target}에 반응을 남겼습니다.`;
    }
    default:
      return item.title;
  }
}

export function getNotificationCursor(
  items: NotificationItem[],
  pageSize = NOTIFICATION_PAGE_SIZE,
): NotificationCursor | null {
  if (items.length < pageSize) return null;
  const last = items.at(-1);
  if (!last) return null;

  return {
    beforeId: last.id,
    beforeLastActivityAt: last.last_activity_at,
  };
}

export function sanitizeNotificationDestination(destination: string): string {
  if (!destination.startsWith("/") || destination.startsWith("//")) {
    return "/noti";
  }

  try {
    const url = new URL(destination, "https://kmla.online");
    return url.origin === "https://kmla.online"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/noti";
  } catch {
    return "/noti";
  }
}
