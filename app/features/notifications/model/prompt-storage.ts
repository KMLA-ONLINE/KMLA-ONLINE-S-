const KEY_PREFIX = "kmla-online:notification-prompt:v2";

/** 첫 진입 창에서 넘긴 사람에게 알림함 카드로 더 권하는 횟수. 카드를 이만큼 닫으면 더 띄우지 않는다. */
export const INBOX_REMINDER_LIMIT = 2;

interface PromptRecord {
  inboxDismissals: number;
}

function key(profileId: number): string {
  return `${KEY_PREFIX}:${profileId}`;
}

/**
 * 기록이 없으면 null이다. 카드 횟수가 없던 옛 기록(`{ handled: true }`)은 0회로 읽어 아직
 * 권한을 정하지 않은 사람에게 카드를 두 번 더 보인다. 읽을 수 없는 값은 이미 답한 것으로 보고 더
 * 권하지 않는다 — 없는 것으로 보면 덮어쓰기 전까지 앱을 열 때마다 창이 뜬다.
 */
function readRecord(profileId: number): PromptRecord | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key(profileId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { inboxDismissals?: unknown } | null;
    const count = parsed?.inboxDismissals;
    return {
      inboxDismissals:
        typeof count === "number" && Number.isFinite(count) ? count : 0,
    };
  } catch {
    return { inboxDismissals: INBOX_REMINDER_LIMIT };
  }
}

function writeRecord(profileId: number, record: PromptRecord): void {
  try {
    window.localStorage.setItem(
      key(profileId),
      JSON.stringify({ handled: true, ...record }),
    );
  } catch {
    // The prompt remains dismissible for the current page without persistence.
  }
}

/** 첫 진입 창을 이미 보여 주고 답을 받았는가. */
export function hasHandledNotificationPrompt(profileId: number): boolean {
  return readRecord(profileId) !== null;
}

export function recordNotificationPromptHandled(profileId: number): void {
  writeRecord(profileId, readRecord(profileId) ?? { inboxDismissals: 0 });
}

/** 첫 진입 창에 답한 뒤에만, 카드를 정해진 횟수만큼 닫기 전까지 알림함에 권한다. */
export function shouldShowInboxReminder(profileId: number): boolean {
  const record = readRecord(profileId);
  return record !== null && record.inboxDismissals < INBOX_REMINDER_LIMIT;
}

export function recordInboxReminderDismissed(profileId: number): void {
  const record = readRecord(profileId) ?? { inboxDismissals: 0 };
  writeRecord(profileId, { inboxDismissals: record.inboxDismissals + 1 });
}

/** 알림을 켰으면 더 권하지 않는다. */
export function recordNotificationEnabled(profileId: number): void {
  writeRecord(profileId, { inboxDismissals: INBOX_REMINDER_LIMIT });
}
